// Fetchwing DevTools panel: wires the views to the background worker.

import { children, newId, pathOf, liveRequests, liveEnvironments } from '../lib/model.js';
import { parseCurl, splitCurlCommands } from '../lib/curl.js';
import { envVars, resolveVars } from '../lib/vars.js';
import { renderTree } from './tree.js';
import { renderTabs } from './tabs.js';
import { openSearch } from './search.js';
import { createRequestEditor } from './request-editor.js';
import { renderResponse } from './response-view.js';
import { renderMockEditor, mockFromResponse, setMockOn } from './mock-editor.js';
import { openEnvironments } from './env-editor.js';
import { openSettings } from './settings-view.js';
import { ensureOrigin } from './permissions.js';
import { el, icon, iconButton, toast, showMenu, openDialog } from './ui.js';

const $ = id => document.getElementById(id);
const send = msg => chrome.runtime.sendMessage(msg);
const store = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem(`fw.${key}`)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(`fw.${key}`, JSON.stringify(value)); } catch {} },
};

const ERRORS = {
  empty_name: 'Name cannot be empty.',
  invalid_move: "Can't move it there.",
  invalid_parent: "Can't create it there.",
  not_found: 'That item no longer exists.',
};

const state = {
  ws: null,
  mockSites: [],
  section: store.get('section', 'collections'),
  selectedId: store.get('selected', null),
  openTabs: store.get('tabs', []),
  expanded: new Set(store.get('expanded', [])),
  responses: new Map(), // requestId -> { loading, startedAt } | { error } | { response }
  pane: 'response',
  editor: null,
  editorFor: null,
  activeId: null, // the request shown in the main area (selection may be a folder)
  inspectedOrigin: null,
  sync: { state: 'off', email: null, error: null, lastSyncAt: null },
};

export const inspectedTabId = chrome.devtools?.inspectedWindow?.tabId ?? (Number(new URLSearchParams(location.search).get('tabId')) || null);

// Theme is chosen in the panel; the first time it starts from the DevTools theme.
const devtoolsDark = chrome.devtools?.panels?.themeName === 'dark' || (!chrome.devtools?.panels && matchMedia('(prefers-color-scheme: dark)').matches);
let mode = store.get('mode', devtoolsDark ? 'dark' : 'light');

function applyMode() {
  document.documentElement.dataset.mode = mode;
  const next = mode === 'dark' ? 'light' : 'dark';
  const btn = document.getElementById('themeBtn');
  btn.replaceChildren(icon(next === 'light' ? 'sun' : 'moon'));
  btn.setAttribute('aria-label', `Switch to ${next} theme`);
  btn.title = `Switch to ${next} theme`;
}
applyMode();
document.getElementById('themeBtn').addEventListener('click', () => {
  mode = mode === 'dark' ? 'light' : 'dark';
  store.set('mode', mode);
  applyMode();
});

export async function mutate(mutation) {
  const res = await send({ type: 'mutate', mutation });
  if (!res?.ok) toast(ERRORS[res?.error] ?? res?.error ?? 'Something went wrong.');
  return res;
}

// DevTools pages get only part of the extension API, so ask DevTools itself
// (or the worker, when the panel runs as a normal tab in tests).
async function inspectedOrigin() {
  if (chrome.devtools?.inspectedWindow) {
    return new Promise(resolve => {
      chrome.devtools.inspectedWindow.eval('location.origin', (result, error) => resolve(error ? null : result));
    });
  }
  if (!inspectedTabId) return null;
  const res = await send({ type: 'tabOrigin', tabId: inspectedTabId });
  return res?.origin ?? null;
}

const isLiveRequest = id => { const it = state.ws?.items[id]; return Boolean(it && !it.deleted && it.type === 'request'); };
const mocksOn = () => liveRequests(state.ws).filter(r => r.mock.enabled);

// ---------- static shell ----------

$('logoMark').append(icon('logo'));
$('searchBox').append(icon('search'), el('span', {}, 'Search requests'), el('span', { class: 'ml-auto mono', style: 'font-size:11px' }, navigator.platform.includes('Mac') ? '⌘K' : 'Ctrl K'));
$('envIcon').append(icon('braces'));
$('settingsBtn').append(icon('gear'));
$('drawerToggle').append(icon('menu'));
const RAIL = { collections: ['folder', 'Collections'], environments: ['braces', 'Environments'], mocks: ['mock', 'Mocks'] };
document.querySelectorAll('.rail [data-section]').forEach(btn => {
  btn.append(icon(RAIL[btn.dataset.section][0]));
  btn.addEventListener('click', () => {
    const narrow = $('app').classList.contains('drawer-open') || getComputedStyle($('side')).position === 'absolute';
    if (narrow && state.section === btn.dataset.section) toggleDrawer();
    else { state.section = btn.dataset.section; store.set('section', state.section); if (narrow) toggleDrawer(true); render(); }
  });
});

function toggleDrawer(open) {
  const app = $('app');
  const on = open ?? !app.classList.contains('drawer-open');
  app.classList.toggle('drawer-open', on);
  $('drawerToggle').setAttribute('aria-label', on ? 'Hide sidebar' : 'Show sidebar');
  $('drawerToggle').title = on ? 'Hide sidebar' : 'Show sidebar';
}
$('drawerToggle').addEventListener('click', () => toggleDrawer());
const closeDrawer = () => $('app').classList.remove('drawer-open');

// ---------- selection, tabs & tree ----------

function persistTabs() { store.set('tabs', state.openTabs); }

function select(id) {
  state.selectedId = id;
  store.set('selected', id);
  if (isLiveRequest(id) && !state.openTabs.includes(id)) {
    state.openTabs.push(id);
    persistTabs();
  }
  if (isLiveRequest(id)) closeDrawer();
  render();
}

function closeTab(id) {
  const at = state.openTabs.indexOf(id);
  if (at === -1) return;
  if (id === state.editorFor) state.editor?.flush();
  state.openTabs.splice(at, 1);
  persistTabs();
  if (state.selectedId === id) {
    state.selectedId = state.openTabs[at] ?? state.openTabs[at - 1] ?? null;
    store.set('selected', state.selectedId);
  }
  render();
}

function expandPath(id) {
  for (let item = state.ws.items[id]; item; item = state.ws.items[item.parentId]) {
    if (item.type !== 'request') state.expanded.add(item.id);
  }
  store.set('expanded', [...state.expanded]);
}

function containerFor(id) {
  const item = state.ws.items[id];
  if (item && !item.deleted) return item.type === 'request' ? item.parentId : item.id;
  return children(state.ws, null)[0]?.id ?? null;
}

async function addItem(itemType, parentId, name, fields) {
  const id = newId();
  const res = await mutate({ type: 'addItem', id, itemType, parentId: itemType === 'collection' ? null : parentId, name, fields });
  return res.ok ? id : null;
}

// New request with no collection yet: make one so the first click just works.
async function ensureContainer(parentId) {
  if (parentId) return parentId;
  const id = await addItem('collection', null, 'My collection');
  if (id) state.expanded.add(id);
  return id;
}

async function createItem(itemType, parentId, name, fields) {
  if (itemType !== 'collection') parentId = await ensureContainer(parentId);
  if (itemType !== 'collection' && !parentId) return null;
  const id = await addItem(itemType, parentId, name, fields);
  if (!id) return null;
  state.ws = (await send({ type: 'getWorkspace' })).workspace;
  if (parentId) expandPath(parentId);
  if (itemType !== 'request') state.expanded.add(id);
  store.set('expanded', [...state.expanded]);
  select(id);
  return id;
}

const newRequest = () => createItem('request', containerFor(state.selectedId), 'New request');

function newMenu(x, y) {
  const parent = containerFor(state.selectedId);
  showMenu(x, y, [
    { label: 'New request', icon: 'plus', action: () => createItem('request', parent, 'New request') },
    { label: 'New folder', icon: 'folder', action: () => createItem('folder', parent, 'New folder') },
    { label: 'New collection', icon: 'folder', action: () => createItem('collection', null, 'New collection') },
  ]);
}

const treeHandlers = {
  onSelect: select,
  onRename: (id, name) => mutate({ type: 'renameItem', id, name }),
  onMove: (id, parentId, order) => mutate({ type: 'moveItem', id, parentId, order }),
  onNew: (type, parentId) => createItem(type, parentId, type === 'folder' ? 'New folder' : 'New request'),
  onDelete: async id => {
    await mutate({ type: 'deleteItem', id });
    state.responses.delete(id);
  },
  isExpanded: id => state.expanded.has(id),
  toggle: id => {
    if (state.expanded.has(id)) state.expanded.delete(id);
    else state.expanded.add(id);
    store.set('expanded', [...state.expanded]);
  },
};

const tabHandlers = {
  onActivate: select,
  onClose: closeTab,
  onNew: newRequest,
  isPending: id => id === state.editorFor && Boolean(state.editor?.isPending()),
};

// ---------- cURL: paste & import ----------

// The tree already shows the method, so the default name is just the path.
function requestName(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return url.slice(0, 60);
  }
}

const fieldsFrom = parsed => {
  const headers = [...parsed.headers];
  if (parsed.cookie) headers.push({ key: 'Cookie', value: parsed.cookie, enabled: true });
  return { method: parsed.method, url: parsed.url, headers, body: parsed.body };
};

async function createFromCurl(text) {
  const parsed = parseCurl(text);
  if (parsed.error) return parsed;
  const id = await createItem('request', containerFor(state.selectedId), requestName(parsed.url), fieldsFrom(parsed));
  if (id && parsed.warnings.length) toast(parsed.warnings.join('; '), 5000);
  return { ok: Boolean(id) };
}

function pasteDialog(initial = '', error = '') {
  openDialog((box, close) => {
    const area = el('textarea', { spellcheck: 'false', placeholder: "curl 'https://api.example.com/…' -H '…'", 'aria-label': 'cURL command' });
    area.value = initial;
    const msg = el('div', { class: 'err', role: 'alert' }, error);
    const create = async () => {
      const res = await createFromCurl(area.value);
      if (res.error) msg.textContent = res.error;
      else if (res.ok) close();
    };
    area.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) create(); });
    box.append(
      el('h2', {}, 'Paste cURL'),
      el('div', { class: 'hint' }, 'Network tab → right-click a request → Copy as cURL'),
      area, msg,
      el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn', onclick: close }, 'Cancel'), el('button', { type: 'button', class: 'btn-primary', onclick: create }, 'Create')),
    );
  });
}

async function pasteCurl() {
  let text = '';
  try {
    text = await navigator.clipboard.readText();
  } catch {
    // DevTools may block clipboard reads; fall back to the dialog.
  }
  if (/^\s*curl(\.exe)?\s/i.test(text)) {
    const res = await createFromCurl(text);
    if (res.error) pasteDialog(text, res.error);
  } else {
    pasteDialog();
  }
}

async function importCurlText(text) {
  const commands = splitCurlCommands(text);
  const parsed = commands.map(parseCurl).filter(p => !p.error);
  const skipped = commands.length - parsed.length;
  if (!parsed.length) {
    toast(commands.length ? `No valid cURL commands (skipped ${skipped})` : 'No cURL commands found');
    return;
  }
  const parentId = await ensureContainer(containerFor(state.selectedId));
  if (!parentId) return;
  let first = null;
  let added = 0;
  for (const p of parsed) {
    const id = await addItem('request', parentId, requestName(p.url), fieldsFrom(p));
    if (id) { added++; first ??= id; }
  }
  state.ws = (await send({ type: 'getWorkspace' })).workspace;
  expandPath(parentId);
  if (first) select(first);
  toast(skipped ? `Imported ${added}, skipped ${skipped}` : `Imported ${added}`, 4000);
}

$('importFile').addEventListener('change', async e => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (file) importCurlText(await file.text());
});

// ---------- send / cancel ----------

async function sendActive() {
  const item = state.ws.items[state.activeId];
  if (!item || item.type !== 'request') return;
  const draft = state.editor?.getDraft() ?? item;
  const { value, missing } = resolveVars(draft.url, envVars(state.ws));
  const fail = (error, detail) => { state.responses.set(item.id, { error, detail }); showPane('response'); };
  if (missing.length) return fail('Unknown variables', missing.map(m => `{{${m}}}`).join(', '));
  let origin;
  try {
    origin = new URL(value).origin;
  } catch {
    return fail('Enter a full URL', 'Start with http:// or https://');
  }
  // Chrome only shows the permission prompt during the click, so nothing is awaited before this.
  const access = await ensureOrigin(origin);
  if (access === 'pending') {
    toast('Allow access in the window that opened, then Send again.', 5000);
    return;
  }
  if (access === 'denied') return fail('No access', `Fetchwing needs permission to reach ${origin}`);
  state.editor?.flush();
  state.responses.set(item.id, { loading: true, startedAt: Date.now() });
  if (state.editorFor === item.id) state.editor?.setSending(true);
  showPane('response');
  const res = await send({ type: 'send', requestId: item.id });
  state.responses.set(item.id, res?.ok ? { response: res.response }
    : res?.cancelled ? { error: 'Cancelled' }
      : { error: 'Request failed', detail: res?.error ?? 'Send failed' });
  if (state.editorFor === item.id) state.editor?.setSending(false);
  if (state.activeId === item.id) renderBottom();
}

const cancelActive = () => send({ type: 'cancelSend', requestId: state.activeId });

async function addVariable(name) {
  if (!liveEnvironments(state.ws).length) {
    const id = newId();
    const res = await mutate({ type: 'addEnvironment', id, name: 'Local' });
    if (!res.ok) return;
    await mutate({ type: 'setActiveEnv', id });
    state.ws = (await send({ type: 'getWorkspace' })).workspace;
  }
  openEnvironments(state, { addVar: name });
}

// ---------- bottom panes ----------

function showPane(name) {
  state.pane = name;
  renderBottom();
}

document.querySelectorAll('.resp-head [data-pane]').forEach(btn => btn.addEventListener('click', () => showPane(btn.dataset.pane)));

function renderBottom() {
  if (!isLiveRequest(state.activeId)) return;
  const item = state.ws.items[state.activeId];
  document.querySelectorAll('.resp-head [data-pane]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.pane === state.pane)));
  $('responsePane').hidden = state.pane !== 'response';
  $('mockPane').hidden = state.pane !== 'mock';
  $('stats').hidden = state.pane !== 'response';
  $('mockTabDot').hidden = !item.mock.enabled;
  if (state.pane === 'response') {
    renderResponse($('responsePane'), $('stats'), state.responses.get(item.id), {
      onRetry: sendActive,
      onMockThis: async response => {
        await mutate({ type: 'updateMock', id: item.id, patch: mockFromResponse(response) });
        showPane('mock');
        toast('Copied into the mock');
      },
    });
  } else {
    renderMockEditor($('mockPane'), item, state);
  }
}

// ---------- top bar ----------

function renderTopbar() {
  const sel = $('envSelect');
  sel.textContent = '';
  sel.append(el('option', { value: '' }, 'No environment'));
  for (const env of liveEnvironments(state.ws)) sel.append(el('option', { value: env.id, selected: env.id === state.ws.activeEnvId }, env.name));
  if (!state.ws.activeEnvId) sel.value = '';

  const on = mocksOn();
  const chip = $('mockChip');
  chip.hidden = !on.length;
  chip.textContent = '';
  chip.append(el('span', { class: 'mdot', 'aria-hidden': 'true' }), String(on.length));
  chip.setAttribute('aria-label', `${on.length} mock${on.length === 1 ? '' : 's'} on`);
  chip.title = `${on.length} mock${on.length === 1 ? '' : 's'} on`;
}

$('envSelect').addEventListener('change', e => mutate({ type: 'setActiveEnv', id: e.target.value || null }));
$('settingsBtn').addEventListener('click', () => openSettings(state));
$('searchBox').addEventListener('click', () => openSearch(state.ws, id => { expandPath(id); select(id); }));
$('searchBox').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('searchBox').click(); } });
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if ($('dialog').hidden) openSearch(state.ws, id => { expandPath(id); select(id); });
  }
});

// ---------- Drive sync ----------

const SYNC_PROBLEM = new Set(['error', 'signin', 'drive', 'confirm']);

function ago(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString();
}

function syncLabel(st) {
  if (st.state === 'off') return 'Sync: off';
  if (st.state === 'syncing') return 'Sync: syncing…';
  if (st.state === 'ok') return `Sync: up to date${st.lastSyncAt ? ` (synced ${ago(st.lastSyncAt)})` : ''}`;
  if (st.state === 'confirm') return 'Sync: waiting for your answer';
  return `Sync: ${st.error ?? 'problem'}`;
}

function renderSync() {
  const st = state.sync;
  const btn = $('syncBtn');
  btn.dataset.state = st.state;
  btn.replaceChildren(icon(st.state === 'off' ? 'cloudOff' : 'cloud'), SYNC_PROBLEM.has(st.state) ? el('span', { class: 'dot', 'aria-hidden': 'true' }) : '');
  btn.setAttribute('aria-label', syncLabel(st));
  btn.title = syncLabel(st);
}

async function syncCall(msg) {
  const res = await send(msg);
  if (res?.confirm) confirmAccountDialog(res.confirm);
  else if (res && !res.ok && res.error) toast(res.error, 5000);
  return res;
}

function confirmAccountDialog({ email, previousEmail }) {
  openDialog((box, close) => {
    const answer = choice => { close(); syncCall({ type: 'syncConfirm', choice }); };
    box.append(
      el('h2', {}, `Sync with ${email}?`),
      el('p', { class: 'hint', style: 'margin:0' }, `This device last synced with ${previousEmail}.`),
      el('div', { class: 'actions', style: 'flex-wrap:wrap' },
        el('button', { type: 'button', class: 'btn', onclick: () => answer('cancel') }, 'Cancel'),
        el('button', { type: 'button', class: 'btn', onclick: () => answer('replace') }, `Use ${email}'s data`),
        el('button', { type: 'button', class: 'btn-primary', onclick: () => answer('merge') }, "Merge this device's data")),
    );
  });
}

$('syncBtn').addEventListener('click', e => {
  const r = e.currentTarget.getBoundingClientRect();
  const st = state.sync;
  const signIn = forceConsent => syncCall({ type: 'syncSignIn', forceConsent });
  const items = [];
  if (st.state === 'off' || !st.email) {
    items.push({ label: 'Sign in with Google', icon: 'cloud', action: () => signIn(false) });
  } else {
    items.push({ label: st.email, disabled: true, action: () => {} });
    if (st.state === 'drive') items.push({ label: 'Allow Drive access', icon: 'cloud', action: () => signIn(true) });
    else if (st.state === 'signin') items.push({ label: 'Sign in again', icon: 'cloud', action: () => signIn(false) });
    else if (st.state === 'error') items.push({ label: st.error, disabled: true, className: 'menu-error', action: () => {} }, { label: 'Retry', icon: 'retry', action: () => syncCall({ type: 'syncNow' }) });
    else items.push({ label: 'Sync now', icon: 'retry', action: () => syncCall({ type: 'syncNow' }) });
    items.push('sep', { label: 'Sign out', icon: 'x', action: () => syncCall({ type: 'syncSignOut' }) });
  }
  showMenu(Math.max(4, r.right - 220), r.bottom + 2, items);
});

const pauseAll = async () => {
  const res = await mutate({ type: 'disableAllMocks' });
  if (res.ok) toast('All mocks paused');
};

$('mockChip').addEventListener('click', e => {
  const r = e.currentTarget.getBoundingClientRect();
  showMenu(r.left, r.bottom + 2, [
    ...mocksOn().map(i => ({
      label: pathOf(state.ws, i.id).join(' / '),
      prefix: el('span', { class: `m ${i.method}` }, i.method),
      action: () => { expandPath(i.id); state.pane = 'mock'; select(i.id); },
    })),
    'sep',
    { label: 'Pause all', icon: 'pause', danger: true, action: pauseAll },
  ]);
});

// ---------- sidebar sections ----------

function renderSide() {
  const title = $('sideTitle');
  const actions = $('sideActions');
  const content = $('sideContent');
  title.textContent = RAIL[state.section][1];
  actions.textContent = '';
  content.textContent = '';
  $('side').setAttribute('aria-label', RAIL[state.section][1]);
  document.querySelectorAll('.rail [data-section]').forEach(btn => {
    if (btn.dataset.section === state.section) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });

  if (state.section === 'collections') {
    actions.append(
      iconButton('clipboard', 'Paste cURL', pasteCurl),
      iconButton('import', 'Import cURL from file', () => $('importFile').click()),
      iconButton('plus', 'New', e => { const r = e.currentTarget.getBoundingClientRect(); newMenu(r.left, r.bottom + 2); }, { 'aria-haspopup': 'menu' }));
    const tree = el('div');
    content.append(tree);
    renderTree(tree, state.ws, state.selectedId, treeHandlers);
  } else if (state.section === 'environments') {
    actions.append(iconButton('plus', 'New environment', async () => {
      const id = newId();
      const res = await mutate({ type: 'addEnvironment', id, name: 'New environment' });
      if (res.ok) { state.ws = (await send({ type: 'getWorkspace' })).workspace; openEnvironments(state, { envId: id }); }
    }));
    const envs = liveEnvironments(state.ws);
    if (!envs.length) content.append(el('div', { class: 'side-empty' }, 'No environments yet.'));
    for (const env of envs) {
      const active = env.id === state.ws.activeEnvId;
      content.append(el('button', {
        type: 'button', class: 'list-row', 'aria-current': active ? 'true' : undefined,
        onclick: () => openEnvironments(state, { envId: env.id }),
      }, icon('braces'), el('span', { class: 'name' }, env.name),
      el('span', { class: 'sub' }, String(env.vars.length)),
      active ? el('span', { class: 'mdot', style: 'background:var(--accent)', title: 'Active', 'aria-label': 'Active' }) : null));
    }
  } else {
    const on = mocksOn();
    actions.append(iconButton('pause', 'Pause all', pauseAll, { disabled: !on.length }));
    // Requests that have a mock set up (on, or edited away from the default).
    const mocks = liveRequests(state.ws).filter(r => r.mock.enabled || r.mock.body || r.mock.headers.length);
    if (!mocks.length) content.append(el('div', { class: 'side-empty' }, 'No mocks yet.'));
    for (const r of mocks) {
      const sw = el('input', {
        type: 'checkbox', class: 'switch', role: 'switch', checked: r.mock.enabled, 'aria-label': `Mock ${r.name}`,
        onclick: e => e.stopPropagation(),
        onchange: async e => {
          const error = await setMockOn(r.id, e.target.checked, state);
          if (error) { e.target.checked = !e.target.checked; toast(error, 5000); }
        },
      });
      content.append(el('div', {
        class: 'list-row', role: 'button', tabindex: '0', title: pathOf(state.ws, r.id).join(' / '),
        onclick: () => { expandPath(r.id); state.pane = 'mock'; select(r.id); },
        onkeydown: e => { if (e.key === 'Enter') e.currentTarget.click(); },
      }, el('span', { class: `m ${r.method}` }, r.method), el('span', { class: 'name' }, r.name), sw));
    }
  }
  const railMocks = document.querySelector('.rail [data-section="mocks"]');
  railMocks.querySelector('.n')?.remove();
  if (mocksOn().length) railMocks.append(el('span', { class: 'n mdot', 'aria-hidden': 'true' }));
}

// ---------- render ----------

function renderEmpty() {
  const box = $('emptyMain');
  box.textContent = '';
  box.append(icon('clipboard', 'big'), el('p', {}, 'Copy as cURL from the Network tab, then paste.'),
    el('div', { class: 'actions' },
      el('button', { type: 'button', class: 'btn-primary', onclick: pasteCurl }, 'Paste cURL'),
      iconButton('plus', 'New request', newRequest, { class: 'btn' })));
}

function render() {
  if (!state.ws) return;
  // Requests deleted elsewhere drop out of the open tabs.
  const live = state.openTabs.filter(isLiveRequest);
  if (live.length !== state.openTabs.length) { state.openTabs = live; persistTabs(); }
  if (state.selectedId && (!state.ws.items[state.selectedId] || state.ws.items[state.selectedId].deleted)) {
    state.selectedId = state.openTabs[state.openTabs.length - 1] ?? null;
    store.set('selected', state.selectedId);
  }

  renderTopbar();
  renderSide();

  // The main area shows the active tab; selecting a folder keeps the last request open.
  const activeId = isLiveRequest(state.selectedId) ? state.selectedId
    : state.openTabs.includes(state.activeId) ? state.activeId : state.openTabs[state.openTabs.length - 1] ?? null;
  state.activeId = activeId;
  renderTabs($('openTabs'), state.ws, state.openTabs, activeId, tabHandlers);
  $('openTabs').hidden = !state.openTabs.length;

  const item = activeId ? state.ws.items[activeId] : null;
  $('emptyMain').hidden = Boolean(item);
  $('work').hidden = !item;
  if (!item) {
    state.editor = null;
    state.editorFor = null;
    renderEmpty();
    return;
  }
  if (state.editorFor !== item.id) {
    state.editor?.flush();
    state.editorFor = item.id;
    state.editor = createRequestEditor($('editor'), item, {
      missingFor: url => resolveVars(url, envVars(state.ws)).missing,
      onChange: patch => mutate({ type: 'updateRequest', id: item.id, patch }),
      onPendingChange: () => renderTabs($('openTabs'), state.ws, state.openTabs, state.activeId, tabHandlers),
      onSend: sendActive,
      onCancel: cancelActive,
      onAddVar: addVariable,
    });
    state.editor.setSending(Boolean(state.responses.get(item.id)?.loading));
  } else {
    state.editor.refreshMissing();
  }
  renderBottom();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.workspace?.newValue) state.ws = changes.workspace.newValue;
  if (changes.mockSites) state.mockSites = changes.mockSites.newValue || [];
  if (changes.syncStatus) { state.sync = { ...state.sync, ...changes.syncStatus.newValue }; renderSync(); }
  if (changes.workspace || changes.mockSites) render();
});

// Known up front so a click can ask for permission without awaiting first
// (Chrome only shows the prompt during the click itself).
chrome.devtools?.network?.onNavigated.addListener(url => {
  try { state.inspectedOrigin = new URL(url).origin; } catch { state.inspectedOrigin = null; }
});

async function init() {
  const res = await send({ type: 'getWorkspace' });
  state.ws = res.workspace;
  state.mockSites = res.mockSites;
  state.inspectedOrigin = await inspectedOrigin();
  const { syncStatus } = await chrome.storage.local.get('syncStatus');
  if (syncStatus) state.sync = { ...state.sync, ...syncStatus };
  renderSync();
  if (!state.expanded.size) for (const c of children(state.ws, null)) state.expanded.add(c.id);
  render();
}

init();
