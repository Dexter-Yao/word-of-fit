// ABOUTME: Maps recorded event and workflow IDs to English founder labels.
// ABOUTME: Unknown provider labels remain identifiable by their original values.

const names: Record<string, string> = {
  login: 'Login', task_completed: 'Completed task', meeting_notes: 'Meeting Notes',
  meeting_handoff_copied: 'Copied a meeting handoff',
  email_draft: 'Email Draft', project_brief: 'Project Brief', feedback_summary: 'Feedback Summary',
};

export function displayName(value: string) {
  return Object.hasOwn(names, value) ? names[value] : value;
}
