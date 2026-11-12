// ABOUTME: Mounts the editable AG Studio report and restores its state after account drill-down.
// ABOUTME: Date and observation rules come from the protected founder route; Studio owns report filters.

import { reportPage, sourceLabels, studioReport } from './studio-report.js';

const target = document.querySelector('#studio-report');
const status = document.querySelector('#studio-status');
const input = document.querySelector('#founder-data');

function initialScope(data, state) {
  const group = data.groupId && data.accounts.find(({ groupId }) => groupId === data.groupId);
  const label = group && (data.groupBy === 'referrer' ? sourceLabels(data).get(group.sourceId) : group.groupLabel);
  if (!label) return state;
  return {
    ...state,
    pages: state.pages.map((page) => {
      if (page.id !== reportPage) return page;
      return {
        ...page,
        ...(label && { crossFilter: { values: { comparison: [{
          group: 0, type: 'value', field: { id: 'accounts.groupLabel' }, values: [label],
        }] } } }),
      };
    }),
  };
}

function initialize() {
  const sdk = globalThis.agStudio;
  if (!sdk) throw new Error('The AG Studio SDK did not load.');
  const data = JSON.parse(input.textContent);
  if (data.licenseKey) sdk.AgStudioLicenseManager.setLicenseKey(data.licenseKey);

  const accountIds = new Set(data.accounts.map(({ accountId }) => accountId));
  const canOpenAccount = (id) => accountIds.has(id);
  const accountHref = (id) => '/founder/users/' + encodeURIComponent(id) + '?' + data.query;
  const storageKey = 'wof-studio:v11:' + data.dataset + ':' + data.query;
  const carriedFiltersKey = 'wof-studio:v11:filters:' + data.dataset;
  const clear = document.querySelector('#studio-clear-selection');
  const edit = document.querySelector('#studio-edit');
  const filterToggle = document.querySelector('#studio-filter-toggle');
  const report = studioReport(sdk, data, {
    accountHref, canOpenAccount, styleNonce: input.nonce,
    filtersCollapsed: matchMedia('(max-width: 840px)').matches,
  });

  let initialState = initialScope(data, report.initialState);
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey));
    if (saved?.pages?.some(({ id }) => id === reportPage)) initialState = saved;
    const carried = JSON.parse(sessionStorage.getItem(carriedFiltersKey));
    sessionStorage.removeItem(carriedFiltersKey);
    if (Array.isArray(carried)) {
      initialState = {
        ...initialState,
        pages: initialState.pages.map((page) => {
          if (page.id !== reportPage) return page;
          return { ...page, filter: { ...page.filter, page: carried }, crossFilter: undefined };
        }),
      };
    }
  } catch {}

  function updateShell(state) {
    const page = state.pages.find(({ id }) => id === state.selectedPageId);
    clear.hidden = !Object.values(page?.crossFilter?.values ?? {}).some((selections) => selections.length);
    filterToggle.setAttribute('aria-pressed', String(state.panels?.filters?.collapsed === false));
    const count = (page?.filter?.page ?? []).filter(({ model }) => model && (!Array.isArray(model.value) || model.value.length)).length;
    filterToggle.textContent = count ? `Filters (${count})` : 'Filters';
  }

  function save(state) {
    try { sessionStorage.setItem(storageKey, JSON.stringify(state)); } catch {}
    updateShell(state);
  }

  const api = sdk.createStudio(target, {
    ...report,
    initialState,
    mode: 'view',
    onStateUpdated: ({ state }) => save(state),
    onStudioReady({ api: ready }) {
      status.hidden = true;
      edit.hidden = false;
      filterToggle.hidden = false;
      save(ready.getState());
    },
    onErrorRaised({ fatal }) {
      if (!fatal) return;
      try { sessionStorage.removeItem(storageKey); } catch {}
      status.hidden = false;
      status.classList.add('error');
      status.textContent = 'The report could not open. Reload to restore the default layout.';
    },
  });

  const groupBy = document.querySelector('#group-by');
  groupBy.addEventListener('change', () => groupBy.form.requestSubmit());
  for (const form of document.querySelectorAll('.report-toolbar form')) {
    form.addEventListener('submit', () => {
      const page = api.getState().pages.find(({ id }) => id === reportPage);
      const filters = page?.filter?.page ?? [];
      try { sessionStorage.setItem(carriedFiltersKey, JSON.stringify(filters)); } catch {}
    });
  }

  filterToggle.addEventListener('click', () => {
    const state = api.getState();
    const filters = state.panels?.filters ?? {};
    api.setState({ ...state, panels: { ...state.panels, filters: { ...filters, collapsed: filters.collapsed === false } } });
  });

  clear.addEventListener('click', () => {
    const state = api.getState();
    api.setState({ ...state, pages: state.pages.map((page) =>
      page.id === state.selectedPageId ? { ...page, crossFilter: undefined } : page) });
  });

  target.addEventListener('click', (event) => {
    if (event.target.closest('a[data-account-id]')) save(api.getState());
  }, true);

  edit.addEventListener('click', () => {
    const editing = api.getProperty('mode') !== 'edit';
    target.classList.toggle('is-editing', editing);
    api.setProperty('mode', editing ? 'edit' : 'view');
    edit.setAttribute('aria-pressed', String(editing));
    edit.textContent = editing ? 'Finish editing' : 'Edit report';
  });
}

try {
  initialize();
} catch (error) {
  console.error(error);
  status.classList.add('error');
  status.textContent = 'The report could not load. Reload the page or check the local setup.';
}
