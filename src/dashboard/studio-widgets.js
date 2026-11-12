// ABOUTME: Renders domain-specific Founder Dashboard charts inside AG Studio widgets.
// ABOUTME: Studio supplies the filtered account set and applies each chart selection to its sibling evidence grid.

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const preciseMoney = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 6 });
const subcentMoney = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 9 });
const percent = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 });
const nanosPerUsd = 1_000_000_000;
const centsPerUsd = 100;
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

function groupBy(rows, by) {
  const groups = new Map();
  for (const row of rows) {
    const key = by(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}

function detailNote(message) {
  return `<p class="wof-studio-note">${esc(message)}</p>`;
}

function select(label, id, choices, selected) {
  return `<label class="wof-studio-select">${esc(label)} <select data-choice="${id}">${choices.map(([value, text]) =>
    `<option value="${esc(value)}"${selected === value ? ' selected' : ''}>${esc(text)}</option>`).join('')}</select></label>`;
}

function heatCell(ids, label, eligible, chart) {
  if (eligible === 0) return '<span class="wof-studio-blank">—</span>';
  const value = ids.length / eligible;
  const text = percent.format(value);
  const description = `${label} · ${ids.length} of ${eligible} · ${text}`;
  return chart.button(ids, text, description, `wof-heat-cell wof-heat-${Math.ceil(value * 5)}`);
}

function heatmap(caption, labels, columns, cell) {
  return `<div class="wof-studio-table-scroll" role="region" aria-label="${esc(caption)}" tabindex="0">
    <table class="wof-studio-heatmap">
    <caption class="wof-studio-sr-only">${esc(caption)}</caption>
    <thead><tr><th scope="col">${esc(caption)}</th>${columns.map((column) => `<th scope="col">${esc(column)}</th>`).join('')}</tr></thead>
    <tbody>${labels.map((label) => `<tr><th scope="row">${esc(label)}</th>${columns.map((column) =>
      `<td>${cell(label, column)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

const retentionGroups = [['signupWeek', 'Signup week'], ['source', 'Referral source'],
  ['firstWorkflow', 'First workflow'], ['signupMonth', 'Signup month']];

function retentionControls({ days, keyLabel }) {
  return [
    ['grouping', 'Group by', retentionGroups],
    ['activity', 'Activity', [['key', keyLabel], ['login', 'Login']]],
    ['interval', 'Interval', [['week', 'Completed weeks'],
      ...Array.from({ length: Math.ceil(days / 14) }, (_, index) => {
        const start = index * 14;
        return [String(start), `Days ${start}–${Math.min(days - 1, start + 13)}`];
      })]],
  ];
}

function retention(data, options, chart) {
  const activity = chart.choices.activity ?? 'key';
  const interval = chart.choices.interval ?? 'week';
  const grouping = chart.choices.grouping ?? 'signupWeek';
  const controls = `<div class="wof-studio-widget-controls">${retentionControls(options).filter(([key]) => key !== 'grouping')
    .map(([key, label, entries]) => select(label, key, entries, chart.choices[key] ?? entries[0][0])).join('')}</div>`;
  const rows = data.retention.filter((row) => row.activityKey === activity &&
    (interval === 'week' ? row.period === 'week'
      : row.period === 'day' && row.intervalIndex >= Number(interval) && row.intervalIndex < Number(interval) + 14));
  const byInterval = new Map([...groupBy(rows, ({ interval: label }) => label)].map(([label, intervalRows]) => [label, {
    eligible: new Set(intervalRows.flatMap(({ eligibleAccountIds }) => eligibleAccountIds)),
    active: new Set(intervalRows.flatMap(({ accountIds }) => accountIds)),
  }]));
  const groupsByLabel = groupBy(data.accounts.filter(({ accountId }) => chart.ids.has(accountId)),
    (row) => grouping === 'source' ? options.labels.get(row.sourceId) : row[grouping] ?? 'No completed task');
  const eligibleGroups = [...groupsByLabel.entries()]
    .filter(([, group]) => group.some(({ accountId }) =>
      [...byInterval.values()].some(({ eligible }) => eligible.has(accountId))))
    .sort(([a], [b]) => a.localeCompare(b));
  if (!eligibleGroups.length) return controls + detailNote('No matching accounts have completed an interval.');
  const byLabel = new Map(eligibleGroups);
  const caption = retentionGroups.find(([key]) => key === grouping)[1];
  return controls + heatmap(caption, [...byLabel.keys()], [...byInterval.keys()], (source, column) => {
    const ids = byLabel.get(source).map(({ accountId }) => accountId);
    const { eligible, active } = byInterval.get(column);
    return heatCell(ids.filter((id) => active.has(id)), `${source} · ${column}`,
      ids.filter((id) => eligible.has(id)).length, chart);
  });
}

function workflow(data, options, chart) {
  const eligible = data.accounts.filter((row) => row.mature && row.observedKey && chart.ids.has(row.accountId));
  if (!eligible.length) return detailNote('No matching full-window accounts have a recorded key action.');
  const first = groupBy(eligible, ({ firstKeyWorkflow }) => firstKeyWorkflow ?? 'Scenario not recorded');
  const byPair = groupBy(data.transitions, ({ firstWorkflow, returnWorkflow }) => JSON.stringify([firstWorkflow, returnWorkflow]));
  const returns = [...new Set(data.transitions.map(({ returnWorkflow }) => returnWorkflow))];
  return heatmap('First key workflow', [...first.keys()].sort(), returns, (initial, next) => {
    const rows = byPair.get(JSON.stringify([initial, next])) ?? [];
    return heatCell(chart.intersect(rows.flatMap(({ accountIds }) => accountIds)), `${initial} → ${next}`, first.get(initial).length, chart);
  });
}

function scenarios(data, { labels }, chart) {
  const rows = data.scenarios.filter(({ scenario, accountIds }) =>
    scenario !== null && accountIds.some((id) => chart.ids.has(id))).sort((a, b) =>
    labels.get(a.sourceId).localeCompare(labels.get(b.sourceId)) || b.users - a.users ||
    a.scenario.localeCompare(b.scenario) || a.action.localeCompare(b.action));
  if (!rows.length) return detailNote('No workflow actions have been recorded for matching full-window accounts.');
  return `<div class="wof-studio-table-scroll" role="region" aria-label="Workflow actions" tabindex="0">
    <table class="wof-studio-evidence">
      <thead><tr><th scope="col">Referral source</th><th scope="col">Workflow</th><th scope="col">Action</th>
        <th scope="col">Accounts with action</th><th scope="col">Action events</th></tr></thead>
      <tbody>${rows.map((row) => {
        const source = labels.get(row.sourceId);
        const accountIds = chart.intersect(row.accountIds);
        const accounts = chart.button(accountIds, accountIds.length,
          `Show ${accountIds.length} accounts · ${source} · ${row.scenario} · ${row.action}`, 'wof-studio-link');
        const actionCount = accountIds.length === row.accountIds.length ? row.actions : '—';
        return `<tr><th scope="row">${esc(source)}</th><td>${esc(row.scenario)}</td><td>${esc(row.action)}</td>
          <td>${accounts}</td><td>${actionCount}</td></tr>`;
      }).join('')}</tbody>
    </table></div>`;
}

function wrapWords(value, limit) {
  const lines = [''];
  for (const word of value.split(/\s+/u)) {
    const characters = Array.from(word);
    for (let index = 0; index < characters.length; index += limit) {
      const chunk = characters.slice(index, index + limit).join('');
      const line = lines.at(-1);
      if (!line) lines[lines.length - 1] = chunk;
      else if (line.length + chunk.length + 1 <= limit) lines[lines.length - 1] += ' ' + chunk;
      else lines.push(chunk);
    }
  }
  return lines;
}

function svgLabel(lines, x, y, anchor = 'start') {
  return `<text class="wof-flow-label" x="${x}" y="${y}" text-anchor="${anchor}" dominant-baseline="middle">${lines
    .map((line, index) => `<tspan x="${x}" dy="${index ? '1.18em' : 0}">${esc(line)}</tspan>`).join('')}</text>`;
}

const stages = ['Signup source', 'First workflow', 'Repeat use', 'Net payment'];

function journey(data, { labels }, chart) {
  const scoped = data.journey.map((row) => ({
    ...row, accountIds: chart.intersect(row.accountIds),
  })).filter(({ accountIds }) => accountIds.length);
  const sourceCount = new Set(scoped.map(({ sourceId }) => sourceId)).size;
  const edges = [...groupBy(scoped.map((row) => {
    if (row.fromStage !== 0) return row;
    if (sourceCount <= 3) return { ...row, from: labels.get(row.sourceId) ?? row.from };
    const from = row.sourceId === 'direct' ? 'Direct signups' : 'Invited signups';
    return { ...row, from, fromId: JSON.stringify([0, from]) };
  }), ({ fromId, toId }) => JSON.stringify([fromId, toId])).values()]
    .map((entries) => ({
      ...entries[0], accountIds: entries.flatMap(({ accountIds }) => accountIds),
    }));
  if (!edges.length) return detailNote('No matching users have completed the observation window.');

  const columns = stages.map(() => new Map());
  for (const edge of edges) {
    for (const direction of ['from', 'to']) {
      const stage = edge[direction + 'Stage'];
      const id = edge[direction + 'Id'];
      const map = columns[stage];
      if (!map.has(id)) {
        const label = edge[direction];
        map.set(id, { label, ids: new Set(), incoming: 0, outgoing: 0 });
      }
      for (const accountId of edge.accountIds) map.get(id).ids.add(accountId);
    }
  }

  const nodes = new Map();
  const wrapNode = (node) => wrapWords(`${node.label} · ${node.ids.size}`, 23);
  const longestLabel = Math.max(...columns.flatMap((column) => [...column.values()].map((node) => wrapNode(node).length)));
  const nodeGap = 9 + longestLabel * 13;
  const largestColumn = Math.max(...columns.map((column) => column.size));
  const total = [...columns[0].values()].reduce((sum, node) => sum + node.ids.size, 0);
  const height = largestColumn === 1 ? 150 : Math.max(225, 52 + largestColumn * (nodeGap + 12));
  const largestNode = Math.max(...columns.flatMap((column) => [...column.values()].map((node) => node.ids.size)));
  const unit = Math.min((height - 48 - (largestColumn - 1) * nodeGap) / total, 92 / largestNode);
  const columnX = (stage) => 19 + stage * 245;
  const headings = stages.map((stage, index) =>
    `<text class="wof-flow-heading" x="${columnX(index)}" y="15">${esc(stage)}</text>`).join('');
  const nodeMarks = columns.map((column, stage) => {
    let y = 32;
    const x = columnX(stage);
    return [...column].map(([id, node]) => {
      const h = node.ids.size * unit;
      nodes.set(id, { ...node, x, y });
      const lines = wrapNode(node);
      const result = `<g><title>${esc(node.label)} · ${node.ids.size}</title>
        <rect class="wof-flow-node" x="${x}" y="${y}" width="6" height="${h}" rx="2"></rect>
        ${svgLabel(lines, x + 10, y + h / 2 - (lines.length - 1) * 7)}</g>`;
      y += h + nodeGap;
      return result;
    }).join('');
  }).join('');
  const links = edges.map((edge) => {
    const from = nodes.get(edge.fromId);
    const to = nodes.get(edge.toId);
    const weight = edge.accountIds.length * unit;
    const y1 = from.y + from.outgoing + weight / 2;
    const y2 = to.y + to.incoming + weight / 2;
    from.outgoing += weight;
    to.incoming += weight;
    const curve = `M ${from.x + 6} ${y1} C ${from.x + 135} ${y1}, ${to.x - 75} ${y2}, ${to.x} ${y2}`;
    const name = `${from.label} → ${to.label} · ${edge.accountIds.length} accounts`;
    return `<path class="wof-flow-link wof-flow-link-${edge.fromStage}" d="${curve}" stroke-width="${Math.max(2, weight - 1)}"
      ${chart.mark(edge.accountIds, name)}><title>${esc(name)}</title></path>`;
  }).join('');
  return `<div class="wof-studio-chart-scroll" role="region" aria-label="Signup journey flow" tabindex="0">
    <svg class="wof-sankey" width="960" height="${height}" viewBox="0 0 960 ${height}" aria-label="Signup source to first workflow, repeat use and net payment">
    ${headings}${links}${nodeMarks}</svg></div>`;
}

export function elapsed(milliseconds) {
  const minutes = Math.floor(milliseconds / 60_000);
  if (minutes < 1) return '<1 min';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ${minutes % 60}m` : `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function timeline(data, { days }, chart) {
  const rows = data.accounts.filter(({ accountId }) => chart.ids.has(accountId)).sort((left, right) =>
    Number(right.paid) - Number(left.paid) || Number(right.repeat) - Number(left.repeat) ||
    right.registeredAt.localeCompare(left.registeredAt) || left.name.localeCompare(right.name));
  if (!rows.length) return detailNote('No matching accounts in this observation window.');
  const pageSize = 8;
  const maxPage = Math.ceil(rows.length / pageSize) - 1;
  const page = Math.max(0, Math.min(Number(chart.choices.page ?? 0), maxPage));
  const start = page * pageSize;
  const milestoneRows = groupBy(data.milestones, ({ accountId }) => accountId);
  const position = (day) => `${Math.min(day, days) * 100 / days}%`;
  const axes = `<span>Account</span><div class="wof-timeline-axis"><span>D0</span><span>D${Math.floor(days / 2)}</span><span>D${days}</span></div>`;
  const marks = rows.slice(start, start + pageSize).map((row) => {
    const items = milestoneRows.get(row.accountId).filter(({ kind }) => kind !== 'observation');
    const markerY = { task: 6, key: 14, capture: 22, refund: 29 };
    return `${chart.accountLink(row)}<svg width="100%" height="34" role="img" aria-label="${esc(row.name)} · ${items.length} recorded events">
      <line class="wof-timeline-future" x1="0" y1="17" x2="100%" y2="17"></line>
      <line class="wof-timeline-observed" x1="0" y1="17" x2="${position(row.observedDays)}" y2="17"></line>
      ${items.map(({ days: day, kind, milestone, ms, amount }) => `<circle class="wof-timeline-marker wof-marker-${kind}"
        cx="${position(day)}" cy="${markerY[kind]}" r="3.3"><title>${esc(milestone)} · ${esc(elapsed(ms))}${amount === null ? '' : ' · ' + money.format(amount)}</title></circle>`).join('')}</svg>`;
  }).join('');
  const legend = '<ul class="wof-timeline-legend"><li class="wof-marker-task">Completed task</li><li class="wof-marker-key">Key behavior</li><li class="wof-marker-capture">Top-up</li><li class="wof-marker-refund">Refund</li></ul>';
  return `<div class="wof-timeline">${axes}${marks}</div>${legend}
    <div class="wof-studio-pager"><span>${start + 1}–${Math.min(start + pageSize, rows.length)} of ${rows.length} accounts</span>
    <button type="button" data-page="${page - 1}"${page <= 0 ? ' disabled' : ''}>Previous</button>
    <button type="button" data-page="${page + 1}"${page >= maxPage ? ' disabled' : ''}>Next</button></div>`;
}

export function renderWaterfall(rows, mark = () => '', width = 745) {
  const x0 = 79;
  const max = Math.max(1, ...rows.flatMap((row) => [row.start, row.start + row.amount]));
  const min = Math.min(0, ...rows.flatMap((row) => [row.start, row.start + row.amount]));
  const y = (value) => 18 + (max - value) * 180 / (max - min);
  const pitch = (width - x0) / rows.length;
  const ticks = [...new Set([max, 0, min])].map((value) => `<line class="wof-waterfall-grid" x1="${x0}" y1="${y(value)}" x2="${width}" y2="${y(value)}"></line>
    <text class="wof-flow-label" x="${x0 - 5}" y="${y(value)}" text-anchor="end" dominant-baseline="middle">${money.format(value)}</text>`).join('');
  const bars = rows.map((row, index) => {
    const end = row.start + row.amount;
    const x = x0 + (index + 0.18) * pitch;
    const center = x + pitch * 0.32;
    const label = `${row.label} · ${preciseMoney.format(row.amount)}`;
    const amount = (Math.abs(row.amount) >= 1 ? money : preciseMoney).format(row.amount);
    return `<rect class="wof-waterfall-${row.tone}" x="${x}" y="${Math.min(y(row.start), y(end))}" width="${pitch * 0.64}"
      height="${Math.max(2, Math.abs(y(row.start) - y(end)))}" rx="3" ${mark(row.ids, label)}>
      <title>${esc(label)}</title></rect>${svgLabel(wrapWords(row.label, 14), center, 220, 'middle')}
      <text class="wof-waterfall-amount" x="${center}" y="257" text-anchor="middle" aria-hidden="true">${esc(amount)}</text>`;
  }).join('');
  return `<div class="wof-studio-chart-scroll" role="region" aria-label="Contribution waterfall" tabindex="0">
    <svg class="wof-waterfall" width="${width}" height="269" viewBox="0 0 ${width} 269" aria-label="Captured payments, completed refunds, and model cost">
    ${ticks}${bars}</svg></div>`;
}

export function formatProfit(amount) {
  return (amount !== 0 && Math.abs(amount) < 0.01 ? subcentMoney : money).format(amount);
}

function waterfall(data, options, chart) {
  const active = data.accounts.filter((row) => row.mature && chart.ids.has(row.accountId));
  if (!active.length) return detailNote('No matching accounts have completed the full observation window.');
  const activeIds = new Set(active.map(({ accountId }) => accountId));
  const missing = active.filter((row) => row.modelCost === null).map(({ accountId }) => accountId);
  const events = data.milestones.filter(({ accountId }) => activeIds.has(accountId));
  const captures = events.filter(({ kind }) => kind === 'capture');
  const refunds = events.filter(({ kind }) => kind === 'refund');
  const sum = (rows, get) => rows.reduce((total, row) => total + get(row), 0);
  const accountIds = (rows) => [...new Set(rows.map(({ accountId }) => accountId))];
  const gross = sum(active, ({ grossCents }) => grossCents) / centsPerUsd;
  const refund = -sum(active, ({ refundCents }) => refundCents) / centsPerUsd;
  const net = sum(active, ({ netCents }) => netCents) / centsPerUsd;
  const paid = active.filter((row) => row.paid && row.modelNanos > 0);
  const unpaid = active.filter((row) => !row.paid && row.modelNanos > 0);
  const paidCost = -sum(paid, ({ modelNanos }) => modelNanos) / nanosPerUsd;
  const unpaidCost = -sum(unpaid, ({ modelNanos }) => modelNanos) / nanosPerUsd;
  const contribution = sum(active, ({ netCents, modelNanos }) =>
    netCents * (nanosPerUsd / centsPerUsd) - modelNanos) / nanosPerUsd;
  const rows = [
    { label: 'Gross top-ups', amount: gross, start: 0, ids: accountIds(captures), tone: 'positive' },
    { label: 'Completed refunds', amount: refund, start: gross, ids: accountIds(refunds), tone: 'negative' },
    { label: 'Net receipts', amount: net, start: 0, ids: [...activeIds], tone: 'total' },
  ];
  if (!missing.length) rows.push(
    { label: 'Paid-user model cost', amount: paidCost, start: net, ids: accountIds(paid), tone: 'negative' },
    { label: 'Unpaid-user model cost', amount: unpaidCost, start: net + paidCost, ids: accountIds(unpaid), tone: 'negative' },
    { label: 'Contribution', amount: contribution, start: 0, ids: [...activeIds], tone: 'total' },
  );
  const note = missing.length
    ? chart.button(missing, `Model cost incomplete · ${missing.length} accounts`, 'Show accounts missing model cost', 'wof-studio-link')
      + detailNote('Contribution is withheld until every required model cost is recorded.')
    : detailNote(active.some(({ estimatedCost }) => estimatedCost)
      ? 'Model cost includes estimates. Processing fees and referral rewards are excluded.'
      : 'Processing fees and referral rewards are excluded.');
  return renderWaterfall(rows, (ids, label) => chart.mark(ids, label)) + note;
}

const widgetInfo = [
  ['founder-retention', 'Retention heatmap', retention],
  ['founder-journey', 'Signup Sankey', journey],
  ['founder-workflow', 'Workflow transition matrix', workflow],
  ['founder-scenarios', 'Actions by workflow', scenarios],
  ['founder-timeline', 'Account timeline', timeline],
  ['founder-waterfall', 'Contribution waterfall', waterfall],
];

export function founderWidgetDefinitions(data, options) {
  return widgetInfo.map(([id, label, render]) => ({
    id, label,
    icon: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M2 13h12v1H1V2h1zm2-2V7h2v4zm3 0V4h2v7zm3 0V2h2v9z"/></svg>',
    dataMapping: {
      account: {
        type: 'field', supportedRoles: ['category'], required: true, requires: { cardinality: 'many' },
      },
    },
    defaultState: { dataMapping: { account: [{ id: 'accounts.accountId' }] } },
    defaultSize: { width: 660, height: 360 },
    minSize: { width: 230, height: 145 },
    featureConfig: { crossFilter: { supportsHighlight: true } },
    form: (params) => {
      const form = params.createDefaults({
        dataMappingItems: [{ key: 'account', label: 'Account ID' }],
      });
      const settings = id === 'founder-retention' ? retentionControls(options).map(([key, label, entries]) => ({
        type: 'select', id: 'format.style.' + key, label, defaultValue: entries[0][0],
        items: entries.map(([value, text]) => ({ value, label: { raw: text } })),
      })) : id === 'founder-timeline' ? [{
        type: 'number', id: 'format.style.page', label: 'Account page', defaultValue: 0, min: 0, step: 1,
      }] : [];
      if (settings.length) form.items[0].items.push({
        type: 'section', key: 'founder-choices', label: 'Analysis settings', items: settings,
      });
      return form;
    },
    comp: class FounderWidget {
      element = document.createElement('div');
      choices = {};
      slices = [];
      ids = new Set();
      selected = new Set();
      generation = 0;

      getGui() {
        return this.element;
      }

      init(params) {
        this.element.className = 'wof-studio-widget';
        this.element.addEventListener('click', this.click);
        this.element.addEventListener('change', this.change);
        this.element.addEventListener('keydown', this.keydown);
        this.refresh(params);
      }

      refresh(params) {
        this.params = params;
        this.choices = params.format?.style ?? {};
        this.load();
      }

      destroy() {
        this.generation += 1;
        this.element.removeEventListener('click', this.click);
        this.element.removeEventListener('change', this.change);
        this.element.removeEventListener('keydown', this.keydown);
      }

      async load() {
        const current = ++this.generation;
        const { dataMapping, widgetApi } = this.params;
        const field = dataMapping.account?.[0];
        if (!field) {
          widgetApi.setDisplayState('incompleteDataMapping');
          return;
        }
        try {
          const { results, replaced } = await widgetApi.getData(
            { fields: [field] }, { queryId: 'founder-accounts', crossFilter: 'filter' },
          );
          if (current !== this.generation || replaced) return;
          if (results.metadata?.error) {
            this.element.innerHTML = detailNote('Studio could not query this account selection.');
            widgetApi.setDisplayState('displayed');
            return;
          }
          this.ids = new Set(results.rows.map((row) => row[field.key]));
          const selections = widgetApi.getCrossFilterSelections();
          this.selected = new Set(selections?.find((selection) => selection.type === 'value')?.values ?? []);
          this.paint();
          widgetApi.setDisplayState('displayed');
        } catch {
          if (current !== this.generation) return;
          this.element.innerHTML = detailNote('Studio could not load this view.');
          widgetApi.setDisplayState('displayed');
        }
      }

      paint() {
        this.slices = [];
        const chart = render(data, options, this);
        const clear = this.selected.size
          ? `<p class="wof-studio-selection"><strong>${this.selected.size} selected</strong>
            <button type="button" data-clear>Clear selection</button></p>`
          : '';
        this.element.innerHTML = chart + clear;
        if (this.focusChoice) {
          this.element.querySelector(`[data-choice="${this.focusChoice}"]`)?.focus({ preventScroll: true });
          this.focusChoice = undefined;
        }
      }

      intersect(ids) {
        return ids.filter((id) => this.ids.has(id));
      }

      mark(ids, name) {
        if (!ids.length) return 'aria-disabled="true"';
        const selected = ids.length === this.selected.size && ids.every((id) => this.selected.has(id));
        const index = this.slices.push(ids) - 1;
        return `data-mark="${index}" tabindex="0" role="button" aria-pressed="${selected}" aria-label="${esc(name)}"`;
      }

      button(ids, label, accessibleName, className) {
        if (!ids.length) return `<span class="${className}" title="${esc(accessibleName)}">${esc(label)}</span>`;
        return `<button type="button" class="${className}" title="${esc(accessibleName)}" ${this.mark(ids, accessibleName)}>${esc(label)}</button>`;
      }

      accountLink(row) {
        return `<a class="wof-studio-account" data-account-id="${esc(row.accountId)}"
          href="${esc(options.accountHref(row.accountId))}">${esc(row.name)}</a>`;
      }

      setSelection(ids) {
        if (this.params.format?.triggerCrossFilter === false) return;
        const { api, widgetId } = this.params;
        const state = api.getState();
        const selected = ids.length === this.selected.size && ids.every((id) => this.selected.has(id));
        const next = selected ? [] : ids;
        api.setState({
          ...state,
          pages: state.pages.map((page) => {
            if (page.id !== state.selectedPageId) return page;
            const values = { ...page.crossFilter?.values };
            delete values[widgetId];
            if (next.length) values[widgetId] = [{
              group: 0, type: 'value', field: { id: 'accounts.accountId' }, values: next,
            }];
            return { ...page, crossFilter: { values } };
          }),
        });
      }

      setChoice(key, value) {
        const { api, widgetId } = this.params;
        const state = api.getState();
        api.setState({
          ...state,
          pages: state.pages.map((page) => {
            if (page.id !== state.selectedPageId) return page;
            const widget = page.widgets[widgetId];
            const values = { ...page.crossFilter?.values };
            delete values[widgetId];
            const format = { ...widget.format, style: { ...widget.format?.style, [key]: value } };
            return {
              ...page, crossFilter: { values },
              widgets: { ...page.widgets, [widgetId]: { ...widget, format } },
            };
          }),
        });
      }

      click = (event) => {
        const target = event.target.closest('[data-mark], [data-clear], [data-page]');
        if (!target) return;
        if (target.dataset.mark !== undefined) this.setSelection(this.slices[Number(target.dataset.mark)]);
        else if (target.hasAttribute('data-clear')) this.setSelection([]);
        else this.setChoice('page', Number(target.dataset.page));
      };

      change = (event) => {
        if (event.target.dataset.choice) {
          this.focusChoice = event.target.dataset.choice;
          this.setChoice(this.focusChoice, event.target.value);
        }
      };

      keydown = (event) => {
        if (event.target instanceof SVGElement && event.target.hasAttribute('data-mark') &&
          (event.key === ' ' || event.key === 'Enter')) {
          event.preventDefault();
          this.setSelection(this.slices[Number(event.target.dataset.mark)]);
        }
      };
    },
  }));
}
