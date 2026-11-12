// ABOUTME: Projects canonical founder summaries into the datasets used by AG Studio.
// ABOUTME: Provider identifiers and task output stay on the protected account audit route.

import { DAY_MS, WEEK_DAYS, signupWeek } from './facts.ts';
import { userGroupKey } from './user-groups.ts';
import { displayName } from './labels.ts';
import { compare, contributionNanos, profitByMonth, profitByPeriod, type UserSummary } from './metrics.ts';
import type { Selection } from './routes.ts';

const USD_NANOS = 1_000_000_000;
const noWorkflow = 'No completed task';
const unrecorded = 'Scenario not recorded';
const noReturn = 'No qualifying return';

function sum<T>(items: T[], value: (item: T) => number): number {
  return items.reduce((total, item) => total + value(item), 0);
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const id = key(item);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id)!.push(item);
  }
  return groups;
}

function ratio(count: number, eligible: number): number | null {
  return eligible ? count / eligible : null;
}

export function posthogFields(user: UserSummary) {
  // These are existing imported PostHog facts. Never infer person properties from an account ID.
  const scenario = user.keyActions[0]?.scenario;
  const lastLogin = user.facts.behavior.findLast(({ name }) => name === 'login');
  return { posthogWorkflow: scenario == null ? null : displayName(scenario), posthogLastLogin: lastLogin?.at ?? null };
}

function projectAccount(user: UserSummary, selection: Selection) {
  const { account, tasks, keyActions, behavior, captures, refunds } = user;
  const start = Date.parse(account.registeredAt);
  const elapsed = (at: string) => Date.parse(at) - start;
  const taskScenarios = new Map(tasks.map((task) => [task.id, task.scenario]));
  const firstAction = keyActions[0];
  const returnAction = firstAction && keyActions.find(({ at }) =>
    elapsed(at) - elapsed(firstAction.at) >= selection.repeatDays * DAY_MS);
  const actionScenario = (action: typeof firstAction | undefined) => {
    const scenario = action?.scenario ?? (action?.taskId ? taskScenarios.get(action.taskId) : undefined);
    return scenario === undefined ? null : displayName(scenario);
  };
  const registered = account.registeredAt.slice(0, 10);
  const observedMs = Math.min(user.age, selection.days * DAY_MS);
  const signupMonth = registered.slice(0, 7);
  const group = userGroupKey(user, selection.groupBy ?? 'referrer');
  const profit = user.missingCost ? null : contributionNanos(user.netCents, user.modelNanos) / USD_NANOS;
  const grossCents = sum(captures, ({ cents }) => cents);
  const refundCents = sum(refunds, ({ cents }) => cents);
  const activity = {
    key: keyActions.map(({ at }) => user.day(at)),
    login: behavior.filter(({ name }) => name === 'login').map(({ at }) => user.day(at)),
    debit: user.credits.filter(({ kind }) => kind === 'task_debit').map(({ at, units }) => ({
      day: user.day(at), units: -units,
    })),
  };
  const row = {
    id: account.id, accountId: account.id, name: account.name,
    sourceId: account.referrerId === null ? 'direct' : 'referrer:' + account.referrerId,
    source: account.referrer ?? 'No code',
    hasReferrer: account.referrerId !== null,
    signupType: account.referrerId === null ? 'Direct' : 'Invited',
    groupId: group.id, groupLabel: group.label,
    signups: 1, completedWindow: Number(user.mature),
    observedKeyCount: Number(keyActions.length > 0), observedPaidCount: Number(user.paid),
    windowRepeat: Number(user.mature && user.repeat),
    repeatStatus: user.mature ? user.repeat ? 'Repeated' : 'Did not repeat' : 'Window in progress',
    windowPaidRepeat: Number(user.mature && user.paid && user.repeat),
    windowCostMissing: Number(user.mature && user.missingCost),
    windowCostEstimated: Number(user.mature && user.estimatedCost),
    windowProfit: user.mature ? profit : null,
    registered, registeredAt: account.registeredAt,
    signupWeek: signupWeek(account.registeredAt),
    ...posthogFields(user),
    signupMonth, signupPeriod: signupMonth,
    ageDays: Math.floor(user.age / DAY_MS), observedMs, observedDays: observedMs / DAY_MS,
    mature: user.mature, paid: user.paid, repeat: user.repeat, observedKey: keyActions.length > 0,
    trialNotConverted: user.trialNotConverted,
    firstWorkflow: tasks[0] ? displayName(tasks[0].scenario) : null,
    firstKeyWorkflow: actionScenario(firstAction), returnKeyWorkflow: actionScenario(returnAction),
    grossCents, refundCents, netCents: user.netCents,
    modelNanos: user.missingCost ? null : user.modelNanos, estimatedCost: user.estimatedCost,
    grossReceipts: grossCents / 100, refunds: refundCents / 100,
    netReceipts: user.netCents / 100, modelCost: user.missingCost ? null : user.modelNanos / USD_NANOS,
    contribution: profit,
    creditsUsed: user.creditsUsed, trialUsed: user.trialUsed, firstTopupMs: user.firstTopupMs,
    topups: captures.length,
    keyActions: keyActions.map(({ at }) => elapsed(at)),
    keyDays: activity.key, loginDays: activity.login, creditDebits: activity.debit,
  };
  const milestones: Array<{ kind: 'observation' | 'task' | 'key' | 'capture' | 'refund'; milestone: string; ms: number; amount: number | null }> = [
    { kind: 'observation', milestone: 'Observation window', ms: observedMs, amount: null },
    ...tasks.map(({ at, scenario }) =>
      ({ kind: 'task' as const, milestone: displayName(scenario), ms: elapsed(at), amount: null })),
    ...keyActions.map(({ at }) =>
      ({ kind: 'key' as const, milestone: selection.keyAction.label, ms: elapsed(at), amount: null })),
    ...captures.map(({ at, cents }) =>
      ({ kind: 'capture' as const, milestone: 'Completed top-up', ms: elapsed(at), amount: cents / 100 })),
    ...refunds.map(({ at, cents }) =>
      ({ kind: 'refund' as const, milestone: 'Completed refund', ms: elapsed(at), amount: -cents / 100 })),
  ];
  return {
    row, user,
    milestones: milestones.sort((a, b) => a.ms - b.ms).map((event, index) => ({
      id: JSON.stringify([row.id, index]), accountId: row.id, name: row.name,
      sourceId: row.sourceId, source: row.source, ...event, days: event.ms / DAY_MS,
    })),
    activity,
  };
}

type ProjectedAccount = ReturnType<typeof projectAccount>;

function ids(members: ProjectedAccount[]): string[] {
  return members.map(({ row }) => row.id);
}

function sourceOf(members: ProjectedAccount[]) {
  const { sourceId, source } = members[0].row;
  return { sourceId, source };
}

function retentionRows(selection: Selection, members: ProjectedAccount[]) {
  const source = sourceOf(members);
  const periods = [{ period: 'day', length: 1, prefix: 'D', shift: 0 },
    { period: 'week', length: WEEK_DAYS, prefix: 'W', shift: 1 }] as const;
  const activities = [['key', selection.keyAction.label], ['login', 'Login']] as const;

  return periods.flatMap(({ period, length, prefix, shift }) => Array.from({
    length: Math.floor(selection.days / length),
  }, (_, intervalIndex) => {
    const fromDay = intervalIndex * length;
    const toDay = fromDay + length;
    const inInterval = (day: number) => day >= fromDay && day < toDay;
    const eligible = members.filter(({ row }) => row.ageDays >= toDay);
    const eligibleAccountIds = ids(eligible);
    const creditsUsed = sum(eligible, ({ activity }) =>
      sum(activity.debit.filter(({ day }) => inInterval(day)), ({ units }) => units));
    return activities.map(([activityKey, activity]) => {
      const counts = eligible.map((member) => ({
        member, count: member.activity[activityKey].filter(inInterval).length,
      }));
      const active = counts.filter(({ count }) => count > 0).map(({ member }) => member);
      return {
        id: JSON.stringify([source.sourceId, period, intervalIndex, activityKey]), ...source,
        period, interval: `${prefix}${intervalIndex + shift}`, intervalIndex, fromDay, toDay,
        eligible: eligible.length, active: active.length, rate: ratio(active.length, eligible.length),
        activity, activityKey, eventCount: sum(counts, ({ count }) => count), creditsUsed,
        accountIds: ids(active), eligibleAccountIds,
      };
    });
  }).flat());
}

function journeyRows(members: ProjectedAccount[], source: ReturnType<typeof sourceOf>) {
  const stages = [
    () => ({ id: source.sourceId, label: source.source }),
    ({ row }: ProjectedAccount) => ({ id: row.firstWorkflow, label: row.firstWorkflow ?? noWorkflow }),
    ({ row }: ProjectedAccount) => ({ id: row.repeat ? 'yes' : 'no', label: row.repeat ? 'Repeated' : 'No repeat' }),
    ({ row }: ProjectedAccount) => ({ id: row.paid ? 'paid' : 'unpaid', label: row.paid ? 'Net paid' : 'No net payment' }),
  ];
  return stages.slice(0, -1).flatMap((stage, fromStage) => {
    const toStage = fromStage + 1;
    const nextStage = stages[toStage];
    const groups = groupBy(members, (member) => JSON.stringify([stage(member).id, nextStage(member).id]));
    return [...groups.values()].map((group) => {
      const from = stage(group[0]);
      const to = nextStage(group[0]);
      const fromId = JSON.stringify([fromStage, from.id]);
      const toId = JSON.stringify([toStage, to.id]);
      return {
        id: JSON.stringify([source.sourceId, fromId, toId]), ...source,
        fromStage, toStage, from: from.label, to: to.label, fromId, toId,
        count: group.length, accountIds: ids(group),
      };
    });
  });
}

function transitionRows(members: ProjectedAccount[], source: ReturnType<typeof sourceOf>, returns: string[]) {
  const recorded = members.filter(({ row }) => row.observedKey);
  const first = groupBy(recorded, ({ row }) => row.firstKeyWorkflow ?? unrecorded);
  return [...first].flatMap(([firstWorkflow, group]) => returns.map((returnWorkflow) => {
    const active = group.filter(({ row }) => (row.repeat ? row.returnKeyWorkflow ?? unrecorded : noReturn) === returnWorkflow);
    return {
      id: JSON.stringify([source.sourceId, firstWorkflow, returnWorkflow]), ...source,
      firstWorkflow, returnWorkflow, eligible: group.length, count: active.length,
      rate: active.length / group.length, accountIds: ids(active),
    };
  }));
}

function contributionRows(
  members: ProjectedAccount[], source: ReturnType<typeof sourceOf>, metrics: ReturnType<typeof compare>,
) {
  if (!metrics.eligible) return [];
  const net = metrics.netCents / 100;
  const gross = metrics.captureCents / 100;
  const paidCost = metrics.missingCost ? null : (metrics.modelNanos - metrics.unpaidNanos) / USD_NANOS;
  const unpaidCost = metrics.missingCost ? null : metrics.unpaidNanos / USD_NANOS;
  const contribution = metrics.contributionNanos === null ? null : metrics.contributionNanos / USD_NANOS;
  const steps = [
    { step: 'Gross top-ups', amount: gross, start: 0, end: gross, members: members.filter(({ row }) => row.topups > 0) },
    { step: 'Completed refunds', amount: (metrics.netCents - metrics.captureCents) / 100,
      start: gross, end: net, members: members.filter(({ user }) => user.refunds.length > 0) },
    { step: 'Net receipts', amount: net, start: 0, end: net, members },
    { step: 'Paid-user model cost', amount: paidCost === null ? null : -paidCost,
      start: paidCost === null ? null : net, end: paidCost === null ? null : net - paidCost,
      members: members.filter(({ row }) => row.paid && (row.modelNanos ?? 0) > 0) },
    { step: 'Unpaid-user model cost', amount: unpaidCost === null ? null : -unpaidCost,
      start: paidCost === null ? null : net - paidCost, end: contribution,
      members: members.filter(({ row }) => !row.paid && (row.modelNanos ?? 0) > 0) },
    { step: 'Contribution', amount: contribution, start: contribution === null ? null : 0, end: contribution, members },
  ];
  const missingAccountIds = ids(members.filter(({ row }) => row.modelNanos === null));
  return steps.map(({ step, amount, start, end, members: active }, stepIndex) => ({
    id: JSON.stringify([source.sourceId, stepIndex]), ...source, step, stepIndex, amount, start, end,
    missingCost: metrics.missingCost, estimatedCost: metrics.estimatedCost, accountIds: ids(active), missingAccountIds,
  }));
}

function accountProfitPeriods(selection: Selection, user: UserSummary) {
  const accountId = user.account.id;
  const point = (period: string, profitPerUserNanos: number | null, estimated: boolean) => ({
    id: JSON.stringify([accountId, period]), accountId, period,
    amount: profitPerUserNanos === null ? null : profitPerUserNanos / USD_NANOS,
    missing: Number(profitPerUserNanos === null), estimated: Number(estimated),
  });
  const interval = selection.profitInterval ?? 'week';
  const elapsed = profitByPeriod([user], selection.days, interval);
  return {
    elapsed: !elapsed.count ? [] : elapsed.periods.map(({ profitPerUserNanos, estimated }, index) => {
      const label = (interval === 'week' ? 'W' : 'D') + String(index + 1).padStart(2, '0');
      return point(label, profitPerUserNanos, estimated);
    }),
    monthly: profitByMonth([user], selection.asOf)
      .map(({ month, profitPerUserNanos, estimated }) => point(month, profitPerUserNanos, estimated)),
  };
}

export function studioData(selection: Selection, users: UserSummary[]) {
  const accounts = users.map((user) => projectAccount(user, selection));
  const profit = users.map((user) => accountProfitPeriods(selection, user));
  const returns = [...new Set(accounts.filter(({ row }) => row.mature && row.observedKey)
    .map(({ row }) => row.repeat ? row.returnKeyWorkflow ?? unrecorded : noReturn))].sort((a, b) =>
    Number(a === noReturn) - Number(b === noReturn) || a.localeCompare(b));
  const groups = [...groupBy(accounts, ({ row }) => row.sourceId).values()].sort((a, b) =>
    a[0].row.source.localeCompare(b[0].row.source) || a[0].row.sourceId.localeCompare(b[0].row.sourceId));
  const bySource = groups.map((members) => {
    const source = sourceOf(members);
    const mature = members.filter(({ row }) => row.mature);
    const metrics = compare(members.map(({ user }) => user), selection);
    const observedKeyUsers = members.filter(({ row }) => row.observedKey).length;
    const observedModelCost = members.some(({ row }) => row.modelNanos === null) ? null
      : sum(members, ({ row }) => row.modelNanos ?? 0) / USD_NANOS;
    const contribution = metrics.contributionNanos === null ? null : metrics.contributionNanos / USD_NANOS;
    return {
      cohort: {
        id: source.sourceId, ...source,
        hasReferrer: source.sourceId !== 'direct',
        signups: members.length, eligible: metrics.eligible, observedKeyUsers,
        observedFirstCompleted: members.filter(({ row }) => row.firstWorkflow !== null).length,
        observedRepeat: members.filter(({ row }) => row.repeat).length,
        observedPaid: members.filter(({ row }) => row.paid).length,
        observedKeyRate: observedKeyUsers / members.length,
        observedNetReceipts: sum(members, ({ row }) => row.netCents) / 100,
        observedModelCost,
        paidRepeat: metrics.paidRepeat, paidRepeatRate: ratio(metrics.paidRepeat, metrics.eligible),
        netReceipts: metrics.eligible ? metrics.netCents / 100 : null,
        modelCost: metrics.eligible && !metrics.missingCost ? metrics.modelNanos / USD_NANOS : null,
        unpaidCost: metrics.eligible && !metrics.unpaidMissing ? metrics.unpaidNanos / USD_NANOS : null,
        contribution, contributionPerAccount: contribution === null ? null : contribution / metrics.eligible,
        averageFirstTopupMs: metrics.avgFirstTopupMs, topups: metrics.captures, repeatTopupUsers: metrics.repeatTopupUsers,
        creditsUsed: metrics.creditsUsed, trialNotConverted: metrics.trialNotConverted,
        estimatedCost: metrics.estimatedCost, missingCost: metrics.missingCost,
        accountIds: ids(members),
      },
      retention: retentionRows(selection, members),
      journey: journeyRows(mature, source),
      transitions: transitionRows(mature, source, returns),
      contribution: contributionRows(mature, source, metrics),
      scenarios: metrics.actions.map((action) => ({
        id: JSON.stringify([source.sourceId, action.name, action.scenario]), ...source,
        action: action.name === selection.keyAction.event ? selection.keyAction.label : displayName(action.name),
        scenario: action.scenario === null ? null : displayName(action.scenario),
        users: action.users.size, actions: action.count, accountIds: [...action.users],
      })),
    };
  });
  return {
    accounts: accounts.map(({ row }) => row),
    cohorts: bySource.map(({ cohort }) => cohort),
    retention: bySource.flatMap(({ retention }) => retention),
    journey: bySource.flatMap(({ journey }) => journey),
    transitions: bySource.flatMap(({ transitions }) => transitions),
    contribution: bySource.flatMap(({ contribution }) => contribution),
    elapsedProfit: profit.flatMap(({ elapsed }) => elapsed),
    monthlyProfit: profit.flatMap(({ monthly }) => monthly),
    milestones: accounts.flatMap(({ milestones }) => milestones),
    scenarios: bySource.flatMap(({ scenarios }) => scenarios),
  };
}
