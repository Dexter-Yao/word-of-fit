// ABOUTME: Renders founder pages, retaining the dataset and active rules on drill-down.
// ABOUTME: Dynamic data is escaped and provider sync uses the existing founder endpoint.

import { wordmark } from '../appearance.ts';
import { escapeHtml as h } from '../http.ts';
import { userGroupings } from './user-groups.ts';
import { WEEK_DAYS } from './facts.ts';
import type { Selection } from './routes.ts';
import { posthogFields, studioData } from './studio-data.ts';
import { observationSpan } from './studio-report.js';
import { formatProfit } from './studio-widgets.js';
import { displayName } from './labels.ts';
import { MAX_COMPARISON_WEEKS, contributionNanos, type UserSummary } from './metrics.ts';
import { style } from './style.ts';

const dash = '—';
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const modelMoney = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 9 });
const counts = new Intl.NumberFormat('en-US');
const utc = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium', timeStyle: 'medium', timeZone: 'UTC',
});
const creditNames = {
  trial_grant: 'Trial credits granted',
  task_debit: 'Credits used',
  topup_grant: 'Top-up credits granted',
};
function label(value: string) {
  return h(displayName(value));
}

function behaviorLabel(event: string, selection: Selection) {
  return event === selection.keyAction.event ? h(selection.keyAction.label) : label(event);
}

function repeatRule(selection: Selection) {
  return `Key behavior: ${h(selection.keyAction.label)} (<code>${h(selection.keyAction.event)}</code>). Repeat use requires two occurrences at least ${selection.repeatDays} days apart.`;
}

function duration(ms: number | null) {
  if (ms === null) return dash;
  const minutes = Math.floor(ms / 60_000);
  if (minutes === 0) return '&lt;1 min';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function windowQuery(days: number): Record<string, string> {
  return days % WEEK_DAYS === 0 ? { weeks: String(days / WEEK_DAYS) } : { days: String(days) };
}

function groupQuery(selection: Selection): Record<string, string> {
  return {
    ...(selection.groupBy && { groupBy: selection.groupBy }),
    ...(selection.groupId && { groupId: selection.groupId }),
    ...(selection.profitInterval && { profitInterval: selection.profitInterval }),
  };
}

function hiddenInputs(values: Record<string, string>) {
  return Object.entries(values).map(([name, value]) =>
    `<input type="hidden" name="${h(name)}" value="${h(value)}">`).join('');
}

function query(selection: Selection, days = selection.days) {
  return new URLSearchParams({
    from: selection.from, to: selection.to,
    ...windowQuery(days), repeatDays: String(selection.repeatDays), ...groupQuery(selection),
    ...(selection.overviewDays && { overviewDays: String(selection.overviewDays) }),
  }).toString();
}

function layout(nonce: string, title: string, content: string, signedIn: boolean) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${h(title)} · Word of Fit</title>
<style nonce="${nonce}">${style}</style>
</head>
<body>
<header><div class="bar"><a class="wof-brand" href="/founder">${wordmark}</a>
${signedIn ? '<button type="button" id="sign-out">Sign out</button>' : ''}
</div></header>
<main><p class="status" id="request-status" role="status"></p>${content}</main>
<script nonce="${nonce}">
const status = document.querySelector('#request-status');
async function post(button, path, body, pending, onSuccess) {
  button.disabled = true;
  status.className = 'status';
  status.textContent = pending;
  try {
    const response = await fetch(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(typeof payload.error === 'string' ? payload.error : 'The request could not be completed.');
    }
    const payload = await response.json();
    onSuccess(payload);
  } catch (error) {
    status.className = 'status error';
    status.textContent = error.message || 'The request could not be completed.';
  } finally {
    button.disabled = false;
  }
}
const signIn = document.querySelector('#founder-signin');
signIn?.addEventListener('submit', (event) => {
  event.preventDefault();
  const token = signIn.elements.namedItem('token');
  post(signIn.querySelector('button'), '/api/founder/session', { token: token.value }, 'Signing in…', () => {
    token.value = '';
    location.reload();
  });
});
const signOut = document.querySelector('#sign-out');
signOut?.addEventListener('click', () => {
  post(signOut, '/api/session/logout', {}, 'Signing out…', () => {
    try {
      for (const key of Object.keys(sessionStorage)) {
        if (key.startsWith('wof-studio:')) sessionStorage.removeItem(key);
      }
    } catch {}
    location.assign('/founder');
  });
});
const sync = document.querySelector('#sync');
sync?.addEventListener('click', () => {
  const userId = sync.dataset.userId;
  post(sync, '/api/sync', userId ? { userId } : {}, 'Reading PostHog and LangSmith…', () => {
    status.textContent = 'Sync request completed. Refreshing…';
    location.reload();
  });
});
</script>
</body></html>`;
}

export function signInPage(nonce: string) {
  return layout(nonce, 'Founder sign-in', `
<h1>Founder sign-in</h1>
<form class="panel signin" id="founder-signin" method="post" action="/api/founder/session">
<label>Founder access token <input name="token" type="password" required></label>
<button class="primary" type="submit">Sign in</button>
</form>`, false);
}

function hero(selection: Selection, title: string, description: string, userId?: string) {
  return `<div class="hero"><div><h1>${h(title)}</h1><p class="muted">${description}</p></div>
${selection.dataset === 'live' ? `<div class="actions"><button type="button" id="sync"${userId ? ` data-user-id="${h(userId)}"` : ''}>Sync records</button></div>` : ''}
</div>`;
}

function weekOptions(selection: Selection) {
  const activeWeeks = selection.days / WEEK_DAYS;
  const weeks = Array.from({ length: MAX_COMPARISON_WEEKS }, (_, index) => {
    const weeks = index + 1;
    return `<option value="${weeks}"${weeks === activeWeeks ? ' selected' : ''}>First ${observationSpan(weeks * WEEK_DAYS)}</option>`;
  }).join('');
  return Number.isInteger(activeWeeks) ? weeks : `<option value="" selected>First ${selection.days} days</option>${weeks}`;
}

function periodSelect(selection: Selection) {
  return `${selection.days % WEEK_DAYS ? hiddenInputs({ days: String(selection.days) }) : ''}
<label>Observation window<select name="weeks">${weekOptions(selection)}</select></label>`;
}

function reportSettings(selection: Selection) {
  return `<details class="report-settings">
    <summary>Window <strong>First ${observationSpan(selection.days)}</strong></summary>
    <form class="filters" method="get" action="/founder" aria-label="Observation window and rules">
      <label>Signed up from (UTC)<input type="date" name="from" value="${h(selection.from)}"></label>
      <label>Signed up through (UTC)<input type="date" name="to" value="${h(selection.to)}"></label>
      ${periodSelect(selection)}
      <label>Days between key actions<input type="number" name="repeatDays" min="1" max="99" required value="${selection.repeatDays}"></label>
      <label>Profit since signup<select name="profitInterval">
        <option value="week">By week</option><option value="day"${selection.profitInterval === 'day' ? ' selected' : ''}>By day</option>
      </select></label>
      ${hiddenInputs(selection.groupBy ? { groupBy: selection.groupBy } : {})}
      <button type="submit">Apply</button>
    </form>
    <p class="muted">${repeatRule(selection)}</p>
  </details>`;
}

function groupingControl(selection: Selection) {
  const grouping = selection.groupBy ?? 'referrer';
  return `<form class="grouping-control" method="get" action="/founder" aria-label="Group users">
    <label for="group-by">Group by</label>
    <select id="group-by" name="groupBy">${userGroupings
      .map(([key, name]) => `<option value="${h(key)}"${key === grouping ? ' selected' : ''}>${h(name)}</option>`).join('')}</select>
    ${hiddenInputs({ from: selection.from, to: selection.to, ...windowQuery(selection.days),
      repeatDays: String(selection.repeatDays), ...(selection.profitInterval && { profitInterval: selection.profitInterval }) })}
  </form>`;
}

function table(name: string, headers: string[], rows: string[][], numericFrom = 1) {
  return `<div class="table-scroll" role="region" aria-label="${h(name)}" tabindex="0">
<table aria-label="${h(name)}"><thead><tr>${headers.map((header, i) =>
    `<th scope="col"${i >= numericFrom ? ' class="numeric"' : ''}>${h(header)}</th>`).join('')}</tr></thead>
<tbody>${rows.map(([first, ...rest]) => `<tr><th scope="row">${first}</th>${rest.map((cell, i) =>
    `<td${i + 1 >= numericFrom ? ' class="numeric"' : ''}>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function stats(values: [string, string][]) {
  return `<dl class="facts">${values.map(([name, value]) => `<div><dt>${h(name)}</dt><dd>${value}</dd></div>`).join('')}</dl>`;
}

function profitAmount(nanos: number | null, estimated: boolean) {
  if (nanos === null) return '<span class="muted">Cost incomplete</span>';
  const amount = nanos / 1_000_000_000;
  return `<span title="${modelMoney.format(amount)}">${formatProfit(amount)}</span>${estimated ? ' <small>Includes estimates</small>' : ''}`;
}

export function founderReportPage(nonce: string, selection: Selection, users: UserSummary[]) {
  const groupBy = selection.groupBy ?? 'referrer';
  const groupExplanation = {
    referrer: 'Each inviter’s signups form a group. Direct signups appear separately.',
    week: 'One group per signup week, starting Monday (UTC).',
    workflow: 'Users are grouped by their first completed workflow.',
  }[groupBy];
  const data = JSON.stringify({
    ...studioData(selection, users),
    dataset: selection.dataset,
    days: selection.days,
    repeatDays: selection.repeatDays,
    keyLabel: selection.keyAction.label,
    groupBy, groupExplanation, groupId: selection.groupId,
    profitInterval: selection.profitInterval ?? 'week',
    query: query(selection),
    licenseKey: process.env.WOF_AG_STUDIO_LICENSE_KEY?.trim() || undefined,
  }).replaceAll('<', '\\u003c');
  return layout(nonce, 'Compare user groups', `
<div class="page-heading">
  <h1>User groups</h1>
  <div class="actions">
    ${selection.dataset === 'live' ? '<button type="button" id="sync">Sync records</button>' : ''}
    <button type="button" id="studio-edit" aria-pressed="false" hidden>Edit report</button>
  </div>
</div>
<div class="report-toolbar">
  ${groupingControl(selection)}
  ${reportSettings(selection)}
  <button type="button" id="studio-filter-toggle" aria-pressed="false" hidden>Filters</button>
  <button type="button" id="studio-clear-selection" hidden>Clear selection</button>
</div>
<section class="studio-shell" aria-label="Founder report">
  <p id="studio-status" role="status">Loading report…</p>
  <div id="studio-report" aria-label="Analytics report"></div>
</section>
<link rel="stylesheet" href="/founder/assets/studio-widgets.css" nonce="${nonce}">
<script nonce="${nonce}" type="application/json" id="founder-data">${data}</script>
<script nonce="${nonce}" src="/founder/assets/ag-studio.min.js" defer></script>
<script nonce="${nonce}" type="module" src="/founder/assets/studio-client.js"></script>`, true);
}

export function detailPage(nonce: string, selection: Selection, user: UserSummary) {
  const { account, facts } = user;
  const showcase = selection.dataset === 'synthetic';
  const { posthogWorkflow, posthogLastLogin } = posthogFields(user);
  const recordedTasks = new Set(facts.costs.map((entry) => entry.taskId));
  const recordDetails = (lines: string[]) => `<details class="record-details"><summary>Record details</summary>${lines.map(
    (line) => `<small>${line}</small>`,
  ).join('')}</details>`;
  const timeline = [
    { at: account.registeredAt, event: 'Registered', record: 'Application account' },
    ...facts.credits.map((entry) => ({
      at: entry.at, event: creditNames[entry.kind],
      record: `${Math.abs(entry.units)} ${Math.abs(entry.units) === 1 ? 'unit' : 'units'}${recordDetails([`Reference ${h(entry.reference)}`])}`,
    })),
    ...facts.behavior.map((entry) => ({
      at: entry.at, event: `${behaviorLabel(entry.name, selection)}${showcase ? '' : ' · PostHog'}`,
      record: `${entry.scenario ? label(entry.scenario) : showcase ? 'Activity recorded' : 'Imported event'}${recordDetails([
        `Event name <code>${h(entry.name)}</code>`, `Event ${h(entry.id)} · Project ${h(entry.projectId)}`,
        ...(entry.taskId ? [`Task ${h(entry.taskId)}`] : []),
        `Imported ${h(utc.format(new Date(entry.importedAt)))} UTC`,
      ])}`,
    })),
    ...facts.tasks.map((task) => ({
      at: task.at, event: 'Task completed · App',
      record: `${label(task.scenario)}
        ${recordedTasks.has(task.id) ? '' : '<small>Model cost pending import</small>'}
        ${recordDetails([`Task ${h(task.id)}`])}`,
    })),
    ...facts.costs.map((entry) => ({
      at: entry.at, event: `${entry.status === 'estimated' ? 'Estimated model cost' : 'Model cost'}${showcase ? '' : ' · LangSmith'}`,
      record: `${entry.nanos === null ? 'Unavailable' : modelMoney.format(entry.nanos / 1_000_000_000)}${recordDetails([
        `Run ${h(entry.id)} · Project ${h(entry.projectId)}`, `Task ${h(entry.taskId)}`,
        `Imported ${h(utc.format(new Date(entry.importedAt)))} UTC`,
      ])}`,
    })),
    ...facts.captures.map((entry) => ({
      at: entry.at, event: showcase ? 'Completed top-up' : 'Completed top-up · PayPal',
      record: `${money.format(entry.cents / 100)}${recordDetails([
        `Capture ${h(entry.id)}`, `Top-up ${h(entry.topupId)}`, ...(entry.orderId ? [`Order ${h(entry.orderId)}`] : []),
      ])}`,
    })),
    ...facts.refunds.map((entry) => ({
      at: entry.at, event: showcase ? 'Completed refund' : 'Completed refund · PayPal',
      record: `${money.format(-entry.cents / 100)}${recordDetails([
        `Refund ${h(entry.id)}`, `Capture ${h(entry.captureId)}`,
      ])}`,
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const started = Date.parse(account.registeredAt);
  const timelineTable = (records: typeof timeline) => table('Account timeline', ['Since signup', 'Event', 'Record'],
    records.map(({ at, event, record }) => [
      `${at === account.registeredAt ? 'At signup' : duration(Date.parse(at) - started)}
      <small><time datetime="${h(at)}">${h(utc.format(new Date(at)))} UTC</time></small>`, event, record,
    ]), 3);
  const inWindow = timeline.filter(({ at }) => user.day(at) < selection.days);
  const later = timeline.slice(inWindow.length);
  const dayCredits = new Map<number, number>();
  for (const entry of user.credits) {
    if (entry.kind !== 'task_debit') continue;
    const day = user.day(entry.at);
    dayCredits.set(day, (dayCredits.get(day) ?? 0) - entry.units);
  }
  return layout(nonce, account.name, `
<p class="back"><a href="/founder?${h(query({ ...selection, overviewDays: undefined }, selection.overviewDays ?? selection.days))}">← Back to user groups</a></p>
${hero(selection, account.name,
    `${account.referrer ? `Registered via ${h(account.referrer)}` : 'No referrer recorded'} · First ${observationSpan(selection.days)}`,
    account.id)}
<section class="panel" aria-labelledby="account-heading">
<h2 id="account-heading">Account summary</h2>
<p class="muted account-id">Account ID ${h(account.id)} · ${repeatRule(selection)}</p>
${posthogWorkflow || posthogLastLogin ? `<p class="muted">
  ${posthogWorkflow ? 'PostHog workflow · ' + h(posthogWorkflow) : ''}
  ${posthogLastLogin ? (posthogWorkflow ? ' · ' : '') + 'Last login · ' + h(utc.format(new Date(posthogLastLogin))) + ' UTC' : ''}
</p>` : ''}
${stats([
    ['Key actions', counts.format(user.keyActions.length)],
    ['Profit', profitAmount(user.missingCost ? null : contributionNanos(user.netCents, user.modelNanos), user.estimatedCost)],
    ['First top-up after signup', duration(user.firstTopupMs)],
    ['Credits used', String(user.creditsUsed)],
  ])}
<p class="muted compact">${user.mature ? `First ${observationSpan(selection.days)} after signup.`
    : `Observed for ${duration(user.age)} since signup.`} ${user.trialUsed} trial credit${user.trialUsed === 1 ? '' : 's'} used · ${user.captures.length} completed top-up${user.captures.length === 1 ? '' : 's'} ·
${user.repeat ? 'Repeat use recorded' : 'Repeat use not recorded'}${user.trialNotConverted ? ' · Trial not converted' : ''}</p>
</section>
<section class="panel timeline" aria-labelledby="timeline-heading">
<h2 id="timeline-heading">Account timeline</h2>
${timelineTable(inWindow)}
${later.length ? `<details><summary>Activity after the first ${observationSpan(selection.days)}</summary>${timelineTable(later)}</details>` : ''}
</section>
<section class="panel" aria-labelledby="credits-heading">
<h2 id="credits-heading">Daily credit use</h2>
${dayCredits.size ? table('Daily credit use', ['Day since registration', 'Credits used'],
    [...dayCredits].map(([day, units]) => [String(day), String(units)])) : '<p>No credit debits in this window.</p>'}
</section>`, true);
}
