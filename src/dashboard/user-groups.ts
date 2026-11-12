// ABOUTME: Assigns each account to a report group using recorded signup and task facts.

import { signupWeek } from './facts.ts';
import { displayName } from './labels.ts';
import type { UserSummary } from './metrics.ts';

export const userGroupings = [
  ['referrer', 'Signup source'], ['workflow', 'First workflow'], ['week', 'Signup week'],
] as const;

export type UserGrouping = typeof userGroupings[number][0];

export function userGroupKey(user: UserSummary, grouping: UserGrouping) {
  if (grouping === 'week') {
    const week = signupWeek(user.account.registeredAt);
    return { id: week, label: week };
  }
  if (grouping === 'workflow') {
    const task = user.tasks[0];
    const workflow = task ? displayName(task.scenario) : 'No completed task';
    return { id: workflow, label: workflow };
  }
  const source = user.account.referrerId === null ? 'direct' : 'referrer:' + user.account.referrerId;
  const label = source === 'direct' ? 'Direct signups' : user.account.referrer ?? 'Referring account';
  return { id: source, label };
}
