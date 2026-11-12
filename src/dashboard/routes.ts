// ABOUTME: Owns the English founder comparison and user drill-down routes.
// ABOUTME: A founder session can inspect only the database selected at server startup.

import { randomBytes } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { HttpError, sendHtml, type Context, type RouteHandler } from '../http.ts';
import { getKeyAction, SYNTHETIC_KEY_ACTION } from '../key-action.ts';
import { getSession, requireFounder } from '../sessions.ts';
import { userGroupings, type UserGrouping } from './user-groups.ts';
import { DAY_MS, WEEK_DAYS, readAccounts, readFacts } from './facts.ts';
import { DEFAULT_COMPARISON_WEEKS, MAX_COMPARISON_WEEKS, summarize, type ProfitInterval, type Window } from './metrics.ts';
import { detailPage, founderReportPage, signInPage } from './views.ts';

const studioAssets = new Map([
  ['ag-studio.min.js', '../../node_modules/ag-studio/dist/umd/ag-studio.min.js'],
  ['studio-client.js', './studio-client.js'],
  ['studio-report.js', './studio-report.js'],
  ['studio-widgets.js', './studio-widgets.js'],
  ['studio-widgets.css', './studio-widgets.css'],
]);

// These fixed AG Studio 3.1.0 CSS blocks are emitted without the provided nonce.
const studioStyleHashes = [
  'ydedGqCb79ipYJuuWRyOTMrKbkjYWv8WIjG7SRdnEPU=',
  'qQh5MACkb9yIcbPdi4lOsJy5dWKd901m0f4cHuMtuF8=',
  'TLR4GbBojMTnKgNWDid3ScmLNCCuE4NUzxTHyMm7Zc4=',
  '47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=',
  'v0HUXSy3Qusqzp0iVIEwlLB9cD3xNdV4yRasIF/Eqq0=',
].map((hash) => ` 'sha256-${hash}'`).join('');

export type Selection = Window & {
  keyAction: ReturnType<typeof getKeyAction>;
  dataset: 'live' | 'synthetic';
  from: string;
  to: string;
  asOf: string;
  groupBy?: UserGrouping;
  groupId?: string;
  profitInterval?: ProfitInterval;
  overviewDays?: number;
};

function readDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HttpError(400, 'Use a date in YYYY-MM-DD format.');
  const iso = `${value}T00:00:00.000Z`;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== iso) {
    throw new HttpError(400, 'Choose a valid registration date.');
  }
  return iso;
}

function readSelection({ url: { searchParams: query }, showcase }: Context): Selection {
  const dataset = showcase ? 'synthetic' : 'live';
  if (query.has('dataset') && query.get('dataset') !== dataset) {
    throw new HttpError(404, 'This data is unavailable in the current workspace.');
  }
  const submittedWeeks = query.get('weeks');
  const savedDays = query.get('days');
  const weeks = submittedWeeks === '' && savedDays !== null ? null : submittedWeeks;
  if (weeks !== null && (!/^[1-9]\d?$/.test(weeks) || Number(weeks) > MAX_COMPARISON_WEEKS)) {
    throw new HttpError(400, `Choose a window from 1 to ${MAX_COMPARISON_WEEKS} weeks.`);
  }
  // Previously shared links retain their exact window. New controls use whole weeks.
  if (weeks === null && savedDays !== null && savedDays !== '60' && savedDays !== '90') {
    throw new HttpError(400, 'Choose an observation window in weeks.');
  }
  const days = weeks !== null ? Number(weeks) * WEEK_DAYS
    : savedDays !== null ? Number(savedDays) : DEFAULT_COMPARISON_WEEKS * WEEK_DAYS;
  const rule = query.get('repeatDays') ?? '14';
  if (!/^[1-9]\d?$/.test(rule)) {
    throw new HttpError(400, 'Choose a repeat-use interval from 1 to 99 days.');
  }
  const from = query.get('from') ?? showcase?.from ?? '';
  const to = query.get('to') ?? showcase?.to ?? '';
  if (from) readDate(from);
  if (to) readDate(to);
  if (from && to && from > to) throw new HttpError(400, 'The start date must precede the end date.');
  const grouping = query.get('groupBy') ?? query.get('audienceBy');
  const groupBy = userGroupings.find(([id]) => id === grouping)?.[0];
  const groupId = query.get('groupId') ?? query.get('audienceGroup') ?? '';
  const profitInterval = query.get('profitInterval') === 'day' ? 'day' : undefined;
  const overviewDays = Number(query.get('overviewDays'));
  const validOverviewDays = overviewDays === 60 || overviewDays === 90 ||
    (overviewDays >= WEEK_DAYS && overviewDays <= MAX_COMPARISON_WEEKS * WEEK_DAYS && overviewDays % WEEK_DAYS === 0);
  return {
    dataset, days, repeatDays: Number(rule), from, to,
    keyAction: dataset === 'synthetic' ? SYNTHETIC_KEY_ACTION : getKeyAction(),
    asOf: showcase?.asOf ?? new Date().toISOString(),
    groupBy, groupId: groupId.length <= 180 ? groupId : '',
    profitInterval,
    overviewDays: validOverviewDays ? overviewDays : undefined,
  };
}

export const route: RouteHandler = async (ctx) => {
  const path = ctx.url.pathname;
  const method = ctx.request.method;
  const asset = method === 'GET' && path.startsWith('/founder/assets/')
    ? studioAssets.get(path.slice('/founder/assets/'.length))
    : undefined;
  if (asset) {
    requireFounder(ctx);
    const file = new URL(asset, import.meta.url);
    const contentType = asset.endsWith('.css') ? 'text/css' : 'text/javascript';
    const size = statSync(file).size;
    ctx.response.writeHead(200, {
      'Content-Type': `${contentType}; charset=utf-8`,
      'Content-Length': size,
    });
    await pipeline(createReadStream(file), ctx.response);
    return true;
  }
  const detail = /^\/founder\/users\/([^/]+)$/.exec(path);
  if (ctx.request.method !== 'GET' || (path !== '/founder' && !detail)) return false;
  const nonce = randomBytes(18).toString('base64');
  const founder = getSession(ctx)?.role === 'founder';
  const report = founder && !detail;
  const source = report ? "'self' " : '';
  const stylesheetPolicy = report ? studioStyleHashes : '';
  const studioPolicy = report ? " img-src 'self' data:;" : '';
  ctx.response.setHeader('Content-Security-Policy',
    `default-src 'none'; script-src ${source}'nonce-${nonce}'; style-src ${source}'nonce-${nonce}'${stylesheetPolicy};${studioPolicy} connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`);
  if (!founder) {
    if (detail) requireFounder(ctx);
    sendHtml(ctx, 200, signInPage(nonce));
    return true;
  }

  const selection = readSelection(ctx);
  const { db } = ctx;
  const { asOf, from, to } = selection;
  const through = to && to !== '9999-12-31' ? new Date(Date.parse(readDate(to)) + DAY_MS).toISOString() : '\uffff';
  if (detail) {
    let id: string;
    try {
      id = decodeURIComponent(detail[1]);
    } catch {
      throw new HttpError(400, 'Invalid account ID.');
    }
    const [account] = readAccounts(db, { id });
    if (!account || account.registeredAt > asOf) throw new HttpError(404, 'Account not found in this workspace.');
    sendHtml(ctx, 200, detailPage(nonce, selection, summarize(account, readFacts(db, account, asOf), asOf, selection)));
    return true;
  }
  const accounts = readAccounts(db, { from: from ? readDate(from) : '', through, asOf });
  sendHtml(ctx, 200, founderReportPage(nonce, selection, accounts.map((account) =>
    summarize(account, readFacts(db, account, asOf), asOf, selection))));
  return true;
};
