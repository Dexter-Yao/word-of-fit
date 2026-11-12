// ABOUTME: Defines the founder's PostHog event and its name in the live dashboard.
// ABOUTME: The fictional showcase compares completed tasks across all of its workflows.

export const MEETING_HANDOFF_COPIED = 'meeting_handoff_copied';
export const SYNTHETIC_KEY_ACTION = { event: 'task_completed', label: 'Completed task' };

export function getKeyAction(env: NodeJS.ProcessEnv = process.env): { event: string; label: string } {
  const event = env.WOF_KEY_ACTION?.trim() || MEETING_HANDOFF_COPIED;
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(event)) throw new Error('WOF_KEY_ACTION must be a lowercase PostHog event name.');
  const label = env.WOF_KEY_ACTION_LABEL?.trim()
    || (event === MEETING_HANDOFF_COPIED ? 'Copied a meeting handoff' : event);
  return { event, label };
}
