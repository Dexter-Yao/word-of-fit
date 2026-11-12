// ABOUTME: Owns the OpenAI, PostHog, and LangSmith HTTP requests for the Meeting Notes flow.
// ABOUTME: Writes use stable provider IDs across retries. Model calls are attempted once per task.

import { HttpError } from '../http.ts';
import { getKeyAction, MEETING_HANDOFF_COPIED } from '../key-action.ts';
import { formatMeetingNotes, meetingNotesFormat, meetingNotesInstructions, parseMeetingNotes } from './meeting-notes.ts';

export const MEETING_NOTES = 'meeting_notes';
export const modelTimeoutMs = 45_000;
const projectMarker = 'word_of_fit_demo';
const langsmithHosts = {
  us: 'api.smith.langchain.com',
  eu: 'eu.api.smith.langchain.com',
  apac: 'apac.api.smith.langchain.com',
  'aws-us': 'aws.api.smith.langchain.com',
};
const uuidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

export type Transport = typeof fetch;
type JsonObject = Record<string, unknown>;
type Usage = {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  input_token_details: { cache_read: number };
};
type TaskInvocation = { taskId: string; userId: string; startedAt: string; completedAt: string };
export type SyncScope = { userId?: string; taskId?: string; since: string; until: string };

export function object(value: unknown): JsonObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value);
}

class ProviderError extends HttpError {
  readonly statusCode: number | undefined;

  constructor(provider: string, statusCode?: number) {
    super(502, statusCode
      ? `${provider} returned HTTP ${statusCode}.`
      : `${provider} could not complete the request.`);
    this.statusCode = statusCode;
  }
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new HttpError(503, `${name} is not configured.`);
  return value;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function createProviders(env: NodeJS.ProcessEnv, transport: Transport) {
  async function post(
    provider: string,
    url: string,
    headers: Record<string, string>,
    payload: JsonObject,
    timeout = 15_000,
  ): Promise<JsonObject> {
    let response: Response;
    try {
      response = await transport(url, {
        method: 'POST',
        redirect: 'error',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeout),
      });
    } catch {
      throw new ProviderError(provider);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new ProviderError(provider, response.status);
    }
    try {
      const body = await response.text();
      const parsed = body ? object(JSON.parse(body)) : {};
      if (parsed) return parsed;
    } catch {
      // Provider error bodies are never passed through to the app.
    }
    throw new ProviderError(provider);
  }

  async function write(
    provider: string,
    url: string,
    headers: Record<string, string>,
    payload: JsonObject,
    duplicateIsSuccess = false,
  ): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await post(provider, url, headers, payload, 4_000);
        return;
      } catch (error) {
        if (!(error instanceof ProviderError)) throw error;
        const status = error.statusCode;
        if (duplicateIsSuccess && status === 409) return;
        if (attempt || (status && status < 500 && status !== 429)) throw error;
      }
    }
  }

  function posthogRegion(): string {
    const region = (env.POSTHOG_REGION ?? 'us').trim().toLowerCase();
    if (region !== 'us' && region !== 'eu') throw new HttpError(503, 'PostHog region is invalid.');
    return region;
  }

  function langsmith() {
    const region = (env.LANGSMITH_REGION ?? 'us').trim().toLowerCase();
    const host = langsmithHosts[region as keyof typeof langsmithHosts];
    const projectId = required(env, 'LANGSMITH_PROJECT_ID');
    const workspace = required(env, 'LANGSMITH_WORKSPACE_ID');
    if (!Object.hasOwn(langsmithHosts, region) || !isUuid(projectId) || !isUuid(workspace)) {
      throw new HttpError(503, 'LangSmith project, workspace, or region is invalid.');
    }
    return {
      projectId,
      url: `https://${host}`,
      headers: { 'X-API-Key': required(env, 'LANGSMITH_API_KEY'), 'X-Tenant-Id': workspace },
    };
  }

  async function runMeetingNotes(notes: string) {
    const model = env.OPENAI_MODEL?.trim() || 'gpt-6-luna';
    const input = [
      { role: 'system', content: meetingNotesInstructions },
      { role: 'user', content: notes },
    ];
    const response = await post('OpenAI Responses', 'https://api.openai.com/v1/responses',
      { Authorization: `Bearer ${required(env, 'OPENAI_API_KEY')}` },
      { model, input, text: { format: meetingNotesFormat }, store: false,
        service_tier: 'default', reasoning: { effort: 'none' } },
      modelTimeoutMs);
    const actualModel = response.model;
    if (response.status !== 'completed' || typeof response.id !== 'string'
        || !response.id.startsWith('resp_') || typeof actualModel !== 'string'
        || (actualModel !== model && !actualModel.startsWith(`${model}-`))) {
      throw new HttpError(502, 'OpenAI did not complete the Meeting Notes task.');
    }
    const output = Array.isArray(response.output) ? response.output.map(object) : [];
    const messages = output.filter((item) => item?.type !== 'reasoning');
    const message = messages[0];
    const content = Array.isArray(message?.content) ? message.content : [];
    const part = object(content[0]);
    if (messages.length !== 1 || message?.type !== 'message' || message.role !== 'assistant'
        || message.status !== 'completed' || content.length !== 1
        || part?.type !== 'output_text' || typeof part.text !== 'string') {
      throw new HttpError(502, 'OpenAI did not return a completed Meeting Notes result.');
    }
    const structured = parseMeetingNotes(part.text, notes);
    const usage = object(response.usage);
    const inputTokens = usage?.input_tokens;
    const outputTokens = usage?.output_tokens;
    const totalTokens = usage?.total_tokens;
    const cached = object(usage?.input_tokens_details)?.cached_tokens ?? 0;
    if (!positiveInteger(inputTokens) || !positiveInteger(outputTokens)
        || !positiveInteger(totalTokens) || totalTokens !== inputTokens + outputTokens
        || typeof cached !== 'number' || !Number.isSafeInteger(cached) || cached < 0 || cached > inputTokens) {
      throw new HttpError(502, 'OpenAI did not return usable token usage for Meeting Notes.');
    }
    const traceUsage: Usage = {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: totalTokens,
      input_token_details: { cache_read: cached },
    };
    return { result: formatMeetingNotes(structured), structured, input, model, responseId: response.id, usage: traceUsage };
  }

  const keyAction = getKeyAction(env).event;
  const eventNames = new Set(['login', 'task_completed', MEETING_HANDOFF_COPIED, keyAction]);

  async function capture(
    event: 'login' | 'task_completed' | typeof MEETING_HANDOFF_COPIED,
    id: string, userId: string, occurredAt: string, taskId?: string,
  ) {
    const properties: JsonObject = { wof_app: projectMarker, $process_person_profile: false };
    if (event !== 'login') {
      properties.task_id = taskId ?? id;
      properties.scenario = MEETING_NOTES;
    }
    await write('PostHog Capture', `https://${posthogRegion()}.i.posthog.com/i/v0/e/`, {}, {
      api_key: required(env, 'POSTHOG_PROJECT_TOKEN'),
      event, uuid: id, distinct_id: userId, timestamp: occurredAt, properties,
    });
  }

  async function trace(task: TaskInvocation, model: Awaited<ReturnType<typeof runMeetingNotes>>) {
    const { projectId, url, headers } = langsmith();
    const dottedTime = task.startedAt.replace(/[-:.Z]/g, '') + '000Z';
    await write('LangSmith run ingestion', `${url}/api/v1/runs`, headers, {
      id: task.taskId,
      trace_id: task.taskId,
      run_type: 'llm',
      name: MEETING_NOTES,
      session_id: projectId,
      start_time: task.startedAt,
      end_time: task.completedAt,
      dotted_order: dottedTime + task.taskId,
      inputs: { messages: model.input },
      outputs: { meeting_notes: model.structured, usage_metadata: model.usage },
      extra: { metadata: {
        app_user_id: task.userId,
        task_id: task.taskId,
        ls_provider: 'openai',
        ls_model_name: model.model,
        openai_response_id: model.responseId,
        usage_metadata: model.usage,
      } },
    }, true);
  }

  async function* queryEvents(scope: SyncScope) {
    const projectId = required(env, 'POSTHOG_PROJECT_ID');
    if (!/^\d+$/.test(projectId)) throw new HttpError(503, 'PostHog project ID is invalid.');
    const url = `https://${posthogRegion()}.posthog.com/api/projects/${projectId}/query/`;
    const headers = { Authorization: `Bearer ${required(env, 'POSTHOG_PERSONAL_API_KEY')}` };
    const filters = [
      `properties.wof_app = '${projectMarker}'`,
      `event IN (${[...eventNames].map((name) => `'${name}'`).join(', ')})`,
      `timestamp >= fromUnixTimestamp64Milli(${Date.parse(scope.since)})`,
      `timestamp < fromUnixTimestamp64Milli(${Date.parse(scope.until)})`,
    ];
    if (scope.userId) filters.push(`distinct_id = '${scope.userId}'`);
    if (scope.taskId) filters.push(`properties.task_id = '${scope.taskId}'`);
    const pageSize = 500;
    const millis = 'toUnixTimestamp64Milli(timestamp)';
    const uuid = 'toString(uuid)';
    let after: string | undefined;
    for (let page = 0; page < 20; page++) {
      const where = after ? [...filters, after] : filters;
      const result = await post('PostHog Query', url, headers, {
        refresh: 'force_blocking',
        query: {
          kind: 'HogQLQuery',
          query: `SELECT ${uuid}, distinct_id, event, properties.task_id, properties.scenario, ${millis} FROM events `
            + `WHERE ${where.join(' AND ')} ORDER BY ${millis} ASC, ${uuid} ASC LIMIT ${pageSize}`,
        },
      });
      if (!Array.isArray(result.results)) throw new HttpError(502, 'PostHog returned an invalid query page.');
      yield { projectId, rows: result.results as unknown[] };
      if (result.results.length < pageSize) return;
      const last = result.results.at(-1);
      if (!Array.isArray(last) || !isUuid(last[0]) || !Number.isSafeInteger(last[5])) {
        throw new HttpError(502, 'PostHog returned an invalid query cursor.');
      }
      const next = `(${millis} > ${last[5]} OR (${millis} = ${last[5]} AND ${uuid} > '${last[0]}'))`;
      if (next === after) throw new HttpError(502, 'PostHog query did not advance.');
      after = next;
    }
    throw new HttpError(502, 'PostHog returned too many events. Sync a single user.');
  }

  async function* queryRuns(scope: SyncScope) {
    const { projectId, url, headers } = langsmith();
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const result = await post('LangSmith Runs Query', `${url}/api/v2/runs/query`, headers, {
        project_ids: [projectId],
        min_start_time: scope.since,
        max_start_time: scope.until,
        run_type: 'LLM',
        selects: ['ID', 'METADATA', 'START_TIME', 'RUN_TYPE', 'TOTAL_COST', 'PRICE_MODEL_ID',
          'PROMPT_TOKENS', 'COMPLETION_TOKENS'],
        filter: scope.taskId ? `and(eq(metadata_key, "task_id"), eq(metadata_value, "${scope.taskId}"))`
          : scope.userId ? `and(eq(metadata_key, "app_user_id"), eq(metadata_value, "${scope.userId}"))` : undefined,
        page_size: 500,
        cursor,
      });
      if (!Array.isArray(result.items)) throw new HttpError(502, 'LangSmith returned an invalid query page.');
      yield { projectId, rows: result.items as unknown[] };
      if (result.next_cursor == null) return;
      if (typeof result.next_cursor !== 'string' || !result.next_cursor || result.next_cursor === cursor) {
        throw new HttpError(502, 'LangSmith returned an invalid query cursor.');
      }
      cursor = result.next_cursor;
    }
    throw new HttpError(502, 'LangSmith returned too many runs. Sync a single user or task.');
  }

  return { runMeetingNotes, capture, trace, queryEvents, queryRuns, eventNames };
}

export type Providers = ReturnType<typeof createProviders>;
