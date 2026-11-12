// ABOUTME: Defines the Founder Dashboard's AG Studio data model, native pages and report layout.
// ABOUTME: Monetary and observation-window facts come from the authorized server projection.

import { founderWidgetDefinitions } from './studio-widgets.js';

export const reportPage = 'referrals';

export function observationSpan(days) {
  if (days % 7 !== 0) return `${days} days`;
  return days === 7 ? 'week' : `${days / 7} weeks`;
}

const accountName = 'accounts.name';
const accountId = { id: 'accounts.accountId' };
const linkedAccountId = { ...accountId, aggregation: 'first' };
const text = 'textFormat';
const integer = 'integerFormat';
const number = 'decimalFormat';
const usd = 'currencyFormat';
const pct = 'percentageFormat';
const bool = 'booleanFormat';
const modelCostFormat = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 9,
});
const tableMoneyFormat = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 3,
});
const smallMoneyFormat = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumSignificantDigits: 3,
});
const rateFormat = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 });

function fields(entries) {
  return entries.map(([id, name, format, description, formatOverride]) => ({
    id, name, format, description,
    ...(format === usd && { formatOptions: { format: formatOverride ?? '$#,##0.00' } }),
    ...(format === pct && { formatOptions: { format: rateFormat } }),
  }));
}

const tables = {
  accounts: {
    name: 'Accounts',
    description: 'One row per signup. Profit covers the days observed within the selected period. A missing profit amount means a required cost has not been recorded.',
    primaryKeyField: 'accountId',
    fields: fields([
      ['accountId', 'Account ID', text],
      ['name', 'Account', text],
      ['source', 'Referral source', text],
      ['sourceId', 'Referral source ID', text],
      ['hasReferrer', 'Referred signup', bool],
      ['signupType', 'Signup type', text],
      ['groupId', 'Group ID', text],
      ['groupLabel', 'User group', text],
      ['signups', 'Signups', integer],
      ['completedWindow', 'Full window', integer],
      ['observedKeyCount', 'Key action', integer],
      ['observedPaidCount', 'Paid', integer],
      ['windowRepeat', 'Full-window repeat users', integer],
      ['windowPaidRepeat', 'Full-window paid and repeat users', integer],
      ['windowCostMissing', 'Full-window missing cost', integer],
      ['windowCostEstimated', 'Full-window estimated cost', integer],
      ['windowProfit', 'Window profit (USD)', usd,
        'Net payments minus model cost for the selected signup window. Requires a full window and complete cost.', modelCostFormat],
      ['repeatStatus', 'Repeat use', text,
        'Whether the key action repeated under the current rule in the selected signup window.'],
      ['registered', 'Signed up', 'dateFormat'],
      ['signupWeek', 'Signup week (UTC)', text],
      ['posthogWorkflow', 'PostHog workflow', text, 'Scenario property of the first recorded key action in the window.'],
      ['posthogLastLogin', 'Last login (PostHog)', 'dateFormat', 'Latest recorded PostHog login date in UTC.'],
      ['signupMonth', 'Signup month', text],
      ['firstWorkflow', 'First workflow', text],
      ['firstKeyWorkflow', 'First key workflow', text],
      ['returnKeyWorkflow', 'Return key workflow', text],
      ['paid', 'Net payer', bool],
      ['repeat', 'Qualifying return', bool],
      ['mature', 'Full window observed', bool],
      ['observedKey', 'Key behavior observed', bool],
      ['observedDays', 'Days observed', number],
      ['grossReceipts', 'Captured top-ups', usd],
      ['refunds', 'Completed refunds', usd],
      ['netReceipts', 'Net receipts', usd],
      ['modelCost', 'Model cost', usd, undefined, modelCostFormat],
      ['contribution', 'Profit', usd, undefined, modelCostFormat],
      ['estimatedCost', 'Includes cost estimate', bool],
      ['creditsUsed', 'Credits used', integer],
      ['trialUsed', 'Trial credits used', integer],
      ['topups', 'Top-ups', integer],
      ['trialNotConverted', 'Trial not converted', bool],
    ]),
  },
  milestones: {
    name: 'Account milestones',
    description: 'One observed milestone per row, linked to the signup. Events include a task, key behavior, completed capture, or refund. Observation rows mark the duration observed and are not actions.',
    primaryKeyField: 'id',
    fields: fields([
      ['id', 'Milestone ID', text], ['accountId', 'Account ID', text], ['kind', 'Milestone kind', text],
      ['milestone', 'Milestone', text], ['days', 'Days since signup', number], ['amount', 'Payment movement', usd],
    ]),
  },

};

for (const [id, name] of [
  ['elapsedProfit', 'Profit since signup'], ['monthlyProfit', 'Calendar month profit'],
]) {
  tables[id] = {
    name, primaryKeyField: 'id',
    description: 'One record per eligible account and period, including zero activity. A missing cost withholds the profit.',
    fields: fields([
      ['id', 'Period ID', text], ['accountId', 'Account ID', text], ['period', 'Period', text],
      ['amount', 'Profit', usd, undefined, modelCostFormat], ['missing', 'Cost missing', integer],
      ['estimated', 'Cost estimated', integer],
    ]),
  };
}

export function sourceLabels(data) {
  const name = ({ sourceId, source }) => sourceId === 'direct' ? 'Direct signups' : source;
  const counts = new Map();
  for (const row of data.cohorts) counts.set(name(row), (counts.get(name(row)) ?? 0) + 1);
  const index = new Map();
  const used = new Set();
  return new Map(data.cohorts.map((row) => {
    const source = name(row);
    let label = source;
    if (counts.get(source) > 1) {
      let position = index.get(source) ?? 0;
      do { label = `${source} (${++position})`; } while (counts.has(label) || used.has(label));
      index.set(source, position);
    }
    used.add(label);
    return [row.sourceId, label];
  }));
}

const field = (table, key, aggregation) => ({ id: `${table}.${key}`, ...(aggregation && { aggregation }) });
const title = (value) => ({ enabled: true, text: value, wrapping: true });

const sum = (table, key) => field(table, key, 'sum');
const numberValue = (value) => ({ type: 'number', value });
const op = (operator, ...inputs) => ({ operator, inputs });
const positive = (value) => op('greaterThan', value, numberValue(0));
const guarded = (test, value) => op('if', test, value, numberValue(null));

function measure(id, name, format, expression, description) {
  return {
    id, name, format, expression, description, isMeasure: true,
    ...(format === pct && { formatOptions: { format: rateFormat } }),
    ...(format === usd && { formatOptions: { format: modelCostFormat } }),
  };
}

const completed = sum('accounts', 'completedWindow');
const counts = [
  ['signupCount', 'Signups', 'signups', 'All matching signups, including users still in their observation window.'],
  ['keyUsers', 'Key action', 'observedKeyCount', 'Matching users who have performed the key action.'],
  ['paidUsers', 'Paid', 'observedPaidCount', 'Matching users with positive net payments so far.'],
  ['fullWindow', 'Full window', 'completedWindow', 'Matching users who completed the full observation window.'],
];
const windowProfit = 'windowProfitPerUser';
const expressions = [
  ...counts.map(([id, name, key, description]) => measure(id, name, integer, sum('accounts', key), description)),
  measure('repeatRate', 'Repeat use', pct,
    guarded(positive(completed), op('divide', sum('accounts', 'windowRepeat'), completed)),
    'Users who repeated the key action divided by those who completed the observation window.'),
  measure('paidRepeatRate', 'Paid & repeated', pct,
    guarded(positive(completed), op('divide', sum('accounts', 'windowPaidRepeat'), completed)),
    'Users who net paid and repeated the key action divided by those who completed the observation window.'),
  measure(windowProfit, 'Profit / user', usd,
    guarded(op('and', positive(completed), op('equals', sum('accounts', 'windowCostMissing'), numberValue(0))),
      op('divide', sum('accounts', 'windowProfit'), completed)),
    'Net payments less model cost per eligible user. Blank when a required cost is missing.'),
  ...['elapsedProfit', 'monthlyProfit'].map((table) =>
    measure(table + 'PerUser', 'Profit / user', usd,
      guarded(op('equals', sum(table, 'missing'), numberValue(0)), field(table, 'amount', 'avg')),
      'Net payments less model cost per eligible user in the period. Blank when a required cost is missing.')),
];

function grid(label, columns, { subtitle, caption, sort, trigger = false, width = 140 } = {}) {
  return {
    type: 'grid',
    dataMapping: { cols: columns },
    format: {
      title: title(label),
      ...(subtitle && { subtitle: title(subtitle) }),
      ...(caption && { caption: title(caption) }),
      crossFilter: 'filter',
      triggerCrossFilter: trigger,
      style: { columnAutoSize: true, columnWidth: width, headerRow: { wrapText: true }, theme: { rowHeight: 35 } },
    },
    ...(sort && { sort: [{ field: sort, direction: 'desc' }] }),
  };
}

const userFilters = [
  ['repeatStatus', 'selection', true],
  ['windowProfit', 'simple', true],
  ['signupType', 'selection', false],
].map(([key, viewTypeId, expanded]) => ({ field: field('accounts', key), view: { viewTypeId, expanded } }));

function comparisonGrid(days, repeatDays, explanation, keyLabel) {
  const repeatNote = repeatDays >= days ? ' The repeat interval is longer than this window allows.' : '';
  return grid('Compare user groups', [
    field('accounts', 'groupLabel'), { id: windowProfit }, { id: 'repeatRate' }, { id: 'paidRepeatRate' },
    { id: 'signupCount' }, { id: 'fullWindow' }, { id: 'keyUsers' }, { id: 'paidUsers' },
  ], {
    subtitle: explanation,
    caption: `Key action: ${keyLabel}. Counts use the first ${observationSpan(days)}, including users still in that window. Rates and profit require a full window.${repeatNote}`,
    sort: { id: 'signupCount' }, trigger: true, width: 136,
  });
}

function accountGrid() {
  return grid('Matching accounts', [
    'name', 'source', 'posthogWorkflow', 'repeatStatus', 'windowProfit', 'registered',
  ].map((key) => field('accounts', key)), {
    sort: field('accounts', 'registered'),
  });
}

function profitChart(table, heading, subtitle) {
  return {
    type: table === 'monthlyProfit' ? 'column-chart-grouped' : 'line-chart',
    dataMapping: {
      categoryKey: [field(table, 'period')],
      valueKey: [{ id: table + 'PerUser' }],
      tooltipKey: [sum(table, 'estimated')],
    },
    sort: [{ field: field(table, 'period'), direction: 'asc' }],
    format: {
      title: title(heading),
      subtitle: title(subtitle),
      caption: title('Net payments minus model cost. Incomplete cost leaves profit unreported.'),
      crossFilter: 'filter',
      triggerCrossFilter: false,
      style: {
        custom: { valueAxis: { title: { enabled: true, text: 'USD per user', fontSize: 11 } } },
        theme: {
          common: { legend: { enabled: false } },
          line: { series: { marker: { enabled: true, size: 7 } } },
        },
      },
    },
  };
}

function layout(entries) {
  return Object.fromEntries(Object.entries(entries).map(([id, [xTrack, yTrack, xSpan, ySpan]]) => [
    id, { xTrack, yTrack, xSpan, ySpan },
  ]));
}

function customWidget(type, heading, subtitle, crossFilter = true) {
  return {
    type, dataMapping: { account: [accountId] },
    format: { title: title(heading), subtitle: title(subtitle), triggerCrossFilter: crossFilter },
  };
}

function accountIdInFilter(filter, reportNames) {
  if (filter?.operator === 'equals') {
    if (filter.field?.id === accountId.id) return filter.value;
    if (filter.field?.id === accountName) return reportNames.get(filter.value);
  }
  if (filter?.operator === 'AND') {
    for (const condition of filter.conditions ?? []) {
      const id = accountIdInFilter(condition, reportNames);
      if (id !== undefined) return id;
    }
  }
}

export function studioReport(sdk, data, { accountHref, canOpenAccount, styleNonce, filtersCollapsed }) {
  const { days, repeatDays, keyLabel } = data;
  const labels = sourceLabels(data);
  const knownIds = new Set(data.accounts.map(({ accountId: id }) => id));
  // An AG Studio grid groups by its visible dimensions. Disambiguate duplicate names
  // while keeping the full account ID in the linked value and the evidence page.
  const nameCounts = new Map();
  for (const { name } of data.accounts) nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  const reportNames = new Map();
  for (const { accountId, name } of data.accounts) {
    let displayName = name;
    if (nameCounts.get(name) > 1) {
      displayName = `${name} · ${accountId.slice(-6)}`;
      while (nameCounts.has(displayName) || reportNames.has(displayName)) displayName += ' · ' + accountId;
    }
    reportNames.set(displayName, accountId);
  }
  const accountNames = new Map([...reportNames].map(([name, id]) => [id, name]));
  const sourceTables = Object.entries(tables).map(([id, schema]) => ({
    id, ...schema,
    data: data[id].map((row) => ({
      ...row, source: labels.get(row.sourceId) ?? row.source,
      ...(id === 'accounts' && {
        name: accountNames.get(row.accountId), firstWorkflow: row.firstWorkflow ?? 'No completed task',
        posthogLastLogin: row.posthogLastLogin?.slice(0, 10) ?? null,
        groupLabel: data.groupBy === 'referrer' ? labels.get(row.sourceId) ?? row.groupLabel : row.groupLabel,
      }),
    })),
  }));
  const custom = founderWidgetDefinitions(data, { accountHref, days, repeatDays, keyLabel, labels });
  const pages = [{
    id: reportPage,
    filter: { page: userFilters },
    widgets: {
      comparison: comparisonGrid(days, repeatDays, data.groupExplanation, keyLabel),
      accounts: accountGrid(),
      journey: customWidget('founder-journey', 'User journey',
        'Full-window users: signup source → first workflow → repeat use → net payment. Payment may happen before a return.'),
      retention: customWidget('founder-retention', 'Retention since signup',
        'Each cell counts users who completed that interval.'),
      workflow: customWidget('founder-workflow', 'Workflows users return for',
        `First key workflow → first qualifying return at least ${repeatDays} days later.`),
      elapsedProfit: profitChart('elapsedProfit', 'Profit per user since signup',
        `By ${data.profitInterval} for users who completed the first ${observationSpan(days)}.`),
      monthlyProfit: profitChart('monthlyProfit', 'Profit per user by calendar month',
        'Completed UTC months. Includes matching users registered by month end.'),
      timeline: customWidget('founder-timeline', 'Account activity timeline',
        'Tasks, key actions and payments since signup.', false),
    },
    widgetLayout: layout({
      comparison: [0, 0, 24, 24], accounts: [0, 24, 24, 18], journey: [0, 42, 24, 30],
      retention: [0, 72, 13, 25], workflow: [13, 72, 11, 25],
      elapsedProfit: [0, 97, 12, 25], monthlyProfit: [12, 97, 12, 25],
      timeline: [0, 122, 24, 30],
    }),
  }];

  return {
    data: {
      sources: sourceTables,
      expressions,
      relationships: [
        ...['milestones', 'elapsedProfit', 'monthlyProfit'].map((table) => ({
          id: table + '-account', source: table + '.accountId', target: 'accounts.accountId', type: 'many-to-one',
        })),
      ],
      options: { fanout: { execute: 'prevent' } },
      description: 'Compare referral groups by repeat use, payments and profit per user. The accounts table shows how much time has been observed for each user.',
    },
    initialState: {
      pages,
      selectedPageId: reportPage,
      panels: {
        filters: { width: 292, collapsed: filtersCollapsed },
        edit: { collapsed: false }, data: { collapsed: true },
      },
    },
    enableFilterEditingInViewMode: true,
    panels: {
      view: { right: ['filters'] },
      edit: { left: ['edit', 'data'], right: ['filters'] },
    },
    styleNonce,
    theme: sdk.studioTheme.withParams({
      accentColor: '#146b55',
      foregroundColor: '#171717',
      backgroundColor: '#ffffff',
      chromeBackgroundColor: '#ffffff',
      borderColor: '#eaeaea',
      browserColorScheme: 'light',
      fontFamily: ['Geist', 'Inter', 'system-ui', 'sans-serif'],
      studioMinWidth: 0,
      studioCanvasPadding: 0,
      studioCanvasBackgroundColor: '#ffffff',
      studioWidgetTitleFontSize: 17,
      studioWidgetTitleFontWeight: 650,
      studioWidgetSubtitleFontSize: 12,
      studioWidgetSubtitleTextColor: '#525252',
      studioWidgetCaptionTextColor: '#525252',
      chartPaletteFills1Color: '#168267',
      chartPaletteFills2Color: '#7cabc0',
      chartPaletteFills3Color: '#bc9459',
      chartPaletteFills4Color: '#856b98',
    }),
    layout: {
      minWidth: 250,
      columns: 24,
      rowHeight: 13,
      pagePadding: 0,
      widgetPadding: 12,
      widgetBorderEnabled: true,
      widgetBorderRadius: 8,
      widgetBorderColor: '#eaeaea',
      widgetBackgroundColor: '#ffffff',
    },
    responsiveLayoutBreakpoints: [{ maxWidth: 720, layout: sdk.singleColumnLayout }],
    widgets: (defaults) => sdk.createWidgets({
      additionalTypes: custom,
      menu: [{ label: 'Founder analytics', widgetIds: custom.map(({ id }) => id) }, ...defaults.menu],
      overrides: [{
        id: 'grid',
        options: {
          getLinkedFields: ({ fieldId }) => {
            if (fieldId === accountName) return [linkedAccountId];
            if (fieldId === windowProfit) return [completed, sum('accounts', 'windowCostEstimated')];
          },
          createCellRenderer: ({ fieldId }) => {
            if (fieldId === windowProfit) return (params) => {
              const cell = document.createElement('span');
              if (params.value == null) {
                cell.textContent = params.getLinkedValue(completed) > 0 ? 'Cost incomplete' : '—';
              } else {
                const estimated = params.getLinkedValue(sum('accounts', 'windowCostEstimated')) > 0;
                const formatter = params.value !== 0 && Math.abs(params.value) < 0.01 ? smallMoneyFormat : tableMoneyFormat;
                cell.textContent = formatter.format(params.value) + (estimated ? ' est.' : '');
                cell.className = params.value < 0 ? 'wof-profit-negative' : params.value > 0 ? 'wof-profit-positive' : '';
                cell.title = modelCostFormat.format(params.value) + (estimated ? ' · Includes model cost estimates' : '');
              }
              return cell;
            };
            if (fieldId !== accountName) return;
            return (params) => {
              const id = params.getLinkedValue(linkedAccountId) ?? reportNames.get(params.value);
              const href = knownIds.has(id) ? accountHref(id) : undefined;
              const element = document.createElement(href ? 'a' : 'span');
              element.textContent = params.valueFormatted ?? String(params.value ?? '');
              if (href) {
                element.href = href;
                element.className = 'wof-studio-account';
                element.dataset.accountId = id;
                element.addEventListener('click', (event) => event.stopPropagation());
              }
              return element;
            };
          },
        },
      }],
    }),
    getContextMenuItems: ({ filter }) => {
      const id = accountIdInFilter(filter, reportNames);
      if (!knownIds.has(id) || !canOpenAccount(id)) return [];
      return [{
        name: 'Open account evidence',
        action: () => { if (canOpenAccount(id)) location.assign(accountHref(id)); },
      }];
    },
  };
}
