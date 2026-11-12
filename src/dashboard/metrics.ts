// ABOUTME: Derives elapsed-time comparisons and user totals from stored facts.
// ABOUTME: Only mature accounts enter window totals and each retention day has its own eligible population.

import { USD_NANOS_PER_CENT } from '../contracts.ts';
import { SYNTHETIC_KEY_ACTION, type getKeyAction } from '../key-action.ts';
import { DAY_MS, WEEK_DAYS, signupWeek, type Account, type Facts } from './facts.ts';

export function contributionNanos(netCents: number, modelNanos: number) {
  return netCents * USD_NANOS_PER_CENT - modelNanos;
}

export const DEFAULT_COMPARISON_WEEKS = 4;
export const MAX_COMPARISON_WEEKS = 12;

export type Window = { days: number; repeatDays: number; keyAction?: ReturnType<typeof getKeyAction> };
export type ProfitInterval = 'day' | 'week';

export function summarize(account: Account, facts: Facts, asOf: string, window: Window) {
  const start = Date.parse(account.registeredAt);
  const day = (at: string) => Math.floor((Date.parse(at) - start) / DAY_MS);
  const within = ({ at }: { at: string }) => {
    const elapsedDays = day(at);
    return elapsedDays >= 0 && elapsedDays < window.days;
  };
  const age = Date.parse(asOf) - start;
  const mature = age >= window.days * DAY_MS;
  const captures = facts.captures.filter(within);
  const refunds = facts.refunds.filter(within);
  const behavior = facts.behavior.filter(within);
  const tasks = facts.tasks.filter(within);
  const costs = facts.costs.filter(within);
  const credits = facts.credits.filter(within);
  const netCents = captures.reduce((sum, capture) => sum + capture.cents, 0)
    - refunds.reduce((sum, refund) => sum + refund.cents, 0);
  // A run and its completed task can fall in different periods. Match them before grouping costs by time.
  const tasksWithRuns = new Set(facts.costs.map((cost) => cost.taskId));
  const missingCostDates = facts.costs.filter(({ nanos }) => nanos === null).map(({ at }) => at)
    .concat(facts.tasks.filter(({ id }) => !tasksWithRuns.has(id))
      .map(({ startedAt }) => startedAt));
  const missingCost = missingCostDates.some((at) => within({ at }));
  const modelNanos = costs.reduce((sum, cost) => sum + (cost.nanos ?? 0), 0);
  const estimatedCost = costs.some((cost) => cost.status === 'estimated');

  const actionName = (window.keyAction ?? SYNTHETIC_KEY_ACTION).event;
  const actionKeys = new Set<string>();
  const keyActions = behavior.filter((event) => {
    if (event.name !== actionName) return false;
    const key = JSON.stringify(event.taskId === null ? [event.projectId, event.id] : [event.taskId]);
    if (actionKeys.has(key)) return false;
    actionKeys.add(key);
    return true;
  });
  const repeat = keyActions.length >= 2
    && Date.parse(keyActions[keyActions.length - 1].at) - Date.parse(keyActions[0].at) >= window.repeatDays * DAY_MS;

  // The ledger records grant and debit units. Attribute use to the trial balance first.
  let trialRemaining = 0;
  let trialUsed = 0;
  let creditsUsed = 0;
  for (const entry of credits) {
    if (entry.kind === 'trial_grant') trialRemaining += entry.units;
    if (entry.kind === 'task_debit') {
      const used = -entry.units;
      const usedFromTrial = Math.min(trialRemaining, used);
      trialUsed += usedFromTrial;
      trialRemaining -= usedFromTrial;
      creditsUsed += used;
    }
  }

  return {
    account, facts, day, age, mature, tasks, behavior, keyActions, captures, refunds, credits, netCents,
    modelNanos, missingCost, missingCostDates, estimatedCost, creditsUsed, trialUsed, repeat,
    paid: netCents > 0,
    firstTopupMs: captures.length ? Date.parse(captures[0].at) - start : null,
    trialNotConverted: mature && trialUsed > 0 && captures.length === 0 && !repeat,
  };
}

export type UserSummary = ReturnType<typeof summarize>;

function moneyTotals() {
  return { netCents: 0, modelNanos: 0, missingCost: false, estimated: false };
}

type MoneyTotals = ReturnType<typeof moneyTotals>;

function addMoney(user: UserSummary, periodAt: (at: string) => MoneyTotals | undefined) {
  for (const { at, cents } of user.facts.captures) {
    const period = periodAt(at);
    if (period) period.netCents += cents;
  }
  for (const { at, cents } of user.facts.refunds) {
    const period = periodAt(at);
    if (period) period.netCents -= cents;
  }
  for (const { at, nanos, status } of user.facts.costs) {
    const period = periodAt(at);
    if (!period) continue;
    period.modelNanos += nanos ?? 0;
    period.estimated ||= status === 'estimated';
  }
  for (const at of user.missingCostDates) {
    const period = periodAt(at);
    if (period) period.missingCost = true;
  }
}

function averageProfit({ netCents, modelNanos, missingCost }: MoneyTotals, count: number) {
  return count && !missingCost ? contributionNanos(netCents, modelNanos) / count : null;
}

export function profitByPeriod(users: UserSummary[], days: number, interval: ProfitInterval) {
  const eligible = users.filter((user) => user.age >= days * DAY_MS);
  const length = interval === 'week' ? WEEK_DAYS : 1;
  const periods = Array.from({ length: Math.ceil(days / length) }, (_, index) => ({
    fromDay: index * length + 1, throughDay: Math.min(days, (index + 1) * length),
    ...moneyTotals(),
  }));
  for (const user of eligible) {
    addMoney(user, (at) => {
      const day = user.day(at);
      return day >= 0 && day < days ? periods[Math.floor(day / length)] : undefined;
    });
  }
  return {
    count: eligible.length,
    periods: periods.map((period) => ({
      fromDay: period.fromDay, throughDay: period.throughDay, estimated: period.estimated,
      profitPerUserNanos: averageProfit(period, eligible.length),
    })),
  };
}

export function profitByMonth(users: UserSummary[], asOf: string) {
  const cutoff = new Date(asOf);
  const monthStart = (offset: number) => new Date(Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + offset, 1)).toISOString();
  const months = new Map(Array.from({ length: 6 }, (_, index) => {
    const month = monthStart(index - 6).slice(0, 7);
    const end = monthStart(index - 5);
    const count = users.filter(({ account }) => account.registeredAt < end).length;
    return [month, { count, ...moneyTotals() }] as const;
  }));
  for (const user of users) addMoney(user, (at) => months.get(at.slice(0, 7)));
  return [...months].flatMap(([month, totals]) => totals.count ? [{
    month, count: totals.count, estimated: totals.estimated,
    profitPerUserNanos: averageProfit(totals, totals.count),
  }] : []);
}

function referralResults(users: UserSummary[]) {
  const netCents = users.reduce((total, user) => total + user.netCents, 0);
  const refundCents = users.reduce((total, user) => total + user.refunds.reduce((sum, refund) => sum + refund.cents, 0), 0);
  const modelNanos = users.reduce((total, user) => total + user.modelNanos, 0);
  const missingCostAccounts = users.filter((user) => user.missingCost).length;
  return {
    keyUsers: users.filter((user) => user.keyActions.length > 0).length,
    paid: users.filter((user) => user.paid).length,
    netCents, grossCents: netCents + refundCents, refundCents, modelNanos, missingCostAccounts,
    estimatedCost: users.some((user) => user.estimatedCost),
    contribution: missingCostAccounts ? null : contributionNanos(netCents, modelNanos),
  };
}

export function referralOverview(users: UserSummary[], asOf: string, comparison: Window) {
  const referrers = new Map<string, { name: string; signups: number }>();
  const weeks = new Map<string, { signups: number; completed: UserSummary[] }>();
  const observed: UserSummary[] = [];
  for (const user of users) {
    const { account, facts } = user;
    if (account.referrerId === null) continue;
    const referrer = referrers.get(account.referrerId) ?? { name: account.referrer ?? 'Referring account', signups: 0 };
    referrer.signups += 1;
    referrers.set(account.referrerId, referrer);

    const week = signupWeek(account.registeredAt);
    const cohort = weeks.get(week) ?? { signups: 0, completed: [] };
    cohort.signups += 1;
    const firstWeek = summarize(account, facts, asOf, { ...comparison, days: WEEK_DAYS });
    if (firstWeek.mature) cohort.completed.push(firstWeek);
    weeks.set(week, cohort);

    const observedDays = Math.floor(user.age / DAY_MS) + 1;
    observed.push(summarize(account, facts, asOf, { ...comparison, days: observedDays }));
  }
  return {
    referringUsers: referrers.size,
    referredSignups: observed.length,
    results: referralResults(observed),
    referrers: [...referrers].map(([id, row]) => ({ id, ...row }))
      .sort((a, b) => b.signups - a.signups || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
    weeks: [...weeks].sort(([a], [b]) => b.localeCompare(a)).map(([start, cohort]) => ({
      start, signups: cohort.signups, eligible: cohort.completed.length, ...referralResults(cohort.completed),
    })),
  };
}

export function compare(users: UserSummary[], window: Window) {
  const mature = users.filter((user) => user.mature);
  const eligible = mature.length;
  const sum = (get: (user: UserSummary) => number) => mature.reduce((total, user) => total + get(user), 0);
  const paidRepeat = mature.filter((user) => user.paid && user.repeat).length;
  const netCents = sum((user) => user.netCents);
  const modelNanos = sum((user) => user.modelNanos);
  const unpaid = mature.filter((user) => !user.paid);
  const unpaidNanos = unpaid.reduce((total, user) => total + user.modelNanos, 0);
  const missingCost = mature.some((user) => user.missingCost);
  const contribution = eligible && !missingCost ? contributionNanos(netCents, modelNanos) : null;

  const actions = new Map<string, { name: string; scenario: string | null; users: Set<string>; count: number }>();
  for (const user of mature) {
    for (const event of user.behavior) {
      const key = JSON.stringify([event.name, event.scenario]);
      const action = actions.get(key) ?? { name: event.name, scenario: event.scenario, users: new Set(), count: 0 };
      action.count += 1;
      action.users.add(user.account.id);
      actions.set(key, action);
    }
  }

  const daily = Array.from({ length: window.days }, (_, day) => {
    const completed = users.filter((user) => user.age >= (day + 1) * DAY_MS);
    const logins = completed.map((user) =>
      user.behavior.filter((event) => event.name === 'login' && user.day(event.at) === day).length);
    const tasks = completed.map((user) => user.keyActions.filter((event) => user.day(event.at) === day).length);
    return {
      day,
      eligible: completed.length,
      loginUsers: logins.filter(Boolean).length,
      logins: logins.reduce((total, value) => total + value, 0),
      taskUsers: tasks.filter(Boolean).length,
      tasks: tasks.reduce((total, value) => total + value, 0),
      creditsUsed: completed.reduce((total, user) => total - user.credits
        .filter((entry) => entry.kind === 'task_debit' && user.day(entry.at) === day)
        .reduce((units, entry) => units + entry.units, 0), 0),
    };
  });

  const firstTopups = mature.flatMap((user) => user.firstTopupMs === null ? [] : [user.firstTopupMs]);
  return {
    eligible, paidRepeat, netCents, modelNanos, unpaidNanos, missingCost, contributionNanos: contribution,
    unpaidMissing: unpaid.some((user) => user.missingCost),
    estimatedUnpaidCost: unpaid.some((user) => user.estimatedCost),
    estimatedCost: mature.some((user) => user.estimatedCost),
    actions: [...actions.values()].sort((a, b) => b.users.size - a.users.size || b.count - a.count),
    daily,
    creditsUsed: sum((user) => user.creditsUsed),
    captures: sum((user) => user.captures.length),
    captureCents: sum((user) => user.captures.reduce((total, capture) => total + capture.cents, 0)),
    repeatTopupUsers: mature.filter((user) => user.captures.length >= 2).length,
    avgFirstTopupMs: firstTopups.length
      ? firstTopups.reduce((total, time) => total + time, 0) / firstTopups.length : null,
    trialNotConverted: mature.filter((user) => user.trialNotConverted).length,
  };
}
