// Fetchwing DevTools panel: wires the views to the background worker.

import { children, newId, pathOf, liveRequests, liveEnvironments } from '../lib/model.js';
import { parseCurl } from '../lib/curl.js';
import { envVars, resolveVars } from '../lib/vars.js';
import { renderTree } from './tree.js';
import { createRequestEditor } from './request-editor.js';
import { renderResponse } from './response-view.js';
import { renderMockEditor, mockFromResponse } from './mock-editor.js';
import { openEnvironments } from './env-editor.js';
import { openSettings } from './settings-view.js';
import { ensureOrigin } from './permissions.js';
import { el, toast, showMenu, openDialog } from './ui.js';

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
  selectedId: store.get('selected', null),
  expanded: new Set(store.get('expanded', [])),
  responses: new Map(), // requestId -> { loading } | { error } | { response }
  pane: 'response',
  editor: null,
  editorFor: null,
};

export const inspectedTabId = chrome.devtools?.inspectedWindow?.tabId ?? (Number(new URLSearchParams(location.search).get('tabId')) || null);

const isDark = chrome.devtools?.panels?.themeName === 'dark' || (!chrome.devtools && matchMedia('(prefers-color-scheme: dark)').matches);
document.documentElement.dataset.theme = isDark ? 'dark' : 'light';

export async function mutate(mutation) {
  const res = await send({ type: 'mutate', mutation });
  if (!res?.ok) toast(ERRORS[res?.error] ?? res?.error ?? 'Something went wrong.');
  return res;
}

// DevTools pages get only part of the extension API, so ask DevTools itself
// (or the worker, when the panel runs as a normal tab in tests).
export async function inspectedOrigin() {
  if (chrome.devtools?.inspectedWindow) {
    return new Promise(resolve => {
      chrome.devtools.inspectedWindow.eval('location.origin', (result, error) => resolve(error ? null : result));
    });
  }
  if (!inspectedTabId) return null;
  const res = await send({ type: 'tabOrigin', tabId: inspectedTabId });
  return res?.origin ?? null;
}

export const getState = () => state;

// ---------- selection & tree ----------

function select(id) {
  state.selectedId = id;
  store.set('selected', id);
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

async function createItem(itemType, parentId, name, fields) {
  const id = newId();
  if (itemType === 'collection') parentId = null;
  else if (!parentId) {
    toast('Create a collection first.');
    return null;
  }
  const res = await mutate({ type: 'addItem', id, itemType, parentId, name, fields });
  if (!res.ok) return null;
  if (parentId) expandPath(parentId);
  if (itemType !== 'request') state.expanded.add(id);
  select(id);
  return id;
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

$('newMenuBtn').addEventListener('click', e => {
  const r = e.currentTarget.getBoundingClientRect();
  const parent = containerFor(state.selectedId);
  showMenu(r.left, r.bottom + 2, [
    { label: 'New request', action: () => createItem('request', parent, 'New request') },
    { label: 'New folder', action: () => createItem('folder', parent, 'New folder') },
    { label: 'New collection', action: () => createItem('collection', null, 'New collection') },
  ]);
});

// ---------- Paste cURL ----------

// The tree already shows the method, so the default name is just the path.
function requestName(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return url.slice(0, 60);
  }
}

async function createFromCurl(text) {
  const parsed = parseCurl(text);
  if (parsed.error) return parsed;
  const headers = [...parsed.headers];
  if (parsed.cookie) headers.push({ key: 'Cookie', value: parsed.cookie, enabled: true });
  const id = await createItem('request', containerFor(state.selectedId), requestName(parsed.url), {
    method: parsed.method, url: parsed.url, headers, body: parsed.body,
  });
  if (id && parsed.warnings.length) toast(`Created. ${parsed.warnings.join('; ')}`, 5000);
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
      el('div', { class: 'hint' }, 'In the Network tab, right-click a request → Copy → Copy as cURL, then paste it here.'),
      area, msg,
      el('div', { class: 'actions' }, el('button', { type: 'button', onclick: close }, 'Cancel'), el('button', { type: 'button', class: 'primary', onclick: create }, 'Create request')),
    );
  });
}

$('pasteCurl').addEventListener('click', async () => {
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
});

// ---------- send ----------

async function sendSelected() {
  const item = state.ws.items[state.selectedId];
  if (!item || item.type !== 'request') return;
  state.editor?.flush();
  const draft = state.editor?.getDraft() ?? item;
  const { value, missing } = resolveVars(draft.url, envVars(state.ws));
  if (missing.length) {
    state.responses.set(item.id, { error: `Unknown variables: ${missing.map(m => `{{${m}}}`).join(', ')}` });
    showPane('response');
    return;
  }
  let origin;
  try {
    origin = new URL(value).origin;
  } catch {
    state.responses.set(item.id, { error: 'Enter a full URL starting with http:// or https://' });
    showPane('response');
    return;
  }
  const access = await ensureOrigin(origin);
  if (access === 'pending') {
    toast('Allow access in the window that opened, then press Send again.', 5000);
    return;
  }
  if (access === 'denied') {
    state.responses.set(item.id, { error: `Fetchwing needs permission to reach ${origin}.` });
    showPane('response');
    return;
  }
  state.responses.set(item.id, { loading: true });
  state.editor?.setSending(true);
  showPane('response');
  const res = await send({ type: 'send', requestId: item.id });
  state.responses.set(item.id, res?.ok ? { response: res.response } : { error: res?.error ?? 'Send failed.' });
  state.editor?.setSending(false);
  if (state.selectedId === item.id) renderBottom();
}

// ---------- bottom panes ----------

function showPane(name) {
  state.pane = name;
  renderBottom();
}

document.querySelectorAll('.bottom .tab').forEach(btn => btn.addEventListener('click', () => showPane(btn.dataset.pane)));

function renderBottom() {
  const item = state.ws.items[state.selectedId];
  if (!item || item.type !== 'request' || item.deleted) return;
  document.querySelectorAll('.bottom .tab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.pane === state.pane)));
  $('responsePane').hidden = state.pane !== 'response';
  $('mockPane').hidden = state.pane !== 'mock';
  $('mockTabState').textContent = item.mock.enabled ? '● ON' : '';
  if (state.pane === 'response') {
    renderResponse($('responsePane'), state.responses.get(item.id), {
      onMockThis: async response => {
        await mutate({ type: 'updateMock', id: item.id, patch: mockFromResponse(response) });
        showPane('mock');
        toast('Response copied into the mock. Turn it on to use it.');
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
  const on = liveRequests(state.ws).filter(r => r.mock.enabled);
  const btn = $('mocksOn');
  btn.hidden = !on.length;
  btn.textContent = `${on.length} mock${on.length === 1 ? '' : 's'} ON`;
}

$('envSelect').addEventListener('change', e => mutate({ type: 'setActiveEnv', id: e.target.value || null }));
$('envEdit').addEventListener('click', () => openEnvironments(state));
$('settingsBtn').addEventListener('click', () => openSettings(state));
$('mocksOn').addEventListener('click', e => {
  const r = e.currentTarget.getBoundingClientRect();
  showMenu(r.left, r.bottom + 2, liveRequests(state.ws).filter(i => i.mock.enabled).map(i => ({
    label: `${i.method} ${pathOf(state.ws, i.id).join(' / ')}`,
    action: () => { expandPath(i.id); select(i.id); showPane('mock'); },
  })));
});

// ---------- render ----------

function render() {
  if (!state.ws) return;
  renderTopbar();
  renderTree($('tree'), state.ws, state.selectedId, treeHandlers);

  const item = state.ws.items[state.selectedId];
  const isRequest = item && !item.deleted && item.type === 'request';
  $('emptyState').hidden = isRequest;
  $('editor').hidden = !isRequest;
  $('bottom').hidden = !isRequest;
  if (!isRequest) {
    state.editor = null;
    state.editorFor = null;
    $('emptyState').textContent = item && !item.deleted
      ? 'Select a request, or right-click this item to add one.'
      : 'Paste a cURL command or create a request to get started.';
    return;
  }
  if (state.editorFor !== item.id) {
    state.editorFor = item.id;
    state.editor = createRequestEditor($('editor'), item, {
      crumbs: pathOf(state.ws, item.id).slice(0, -1).concat(item.name),
      missingFor: url => resolveVars(url, envVars(state.ws)).missing,
      onChange: patch => mutate({ type: 'updateRequest', id: item.id, patch }),
      onSend: sendSelected,
    });
  } else {
    state.editor.refreshMissing();
  }
  renderBottom();
}

export const rerender = render;

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.workspace?.newValue) state.ws = changes.workspace.newValue;
  if (changes.mockSites) state.mockSites = changes.mockSites.newValue || [];
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
  if (!state.expanded.size) for (const c of children(state.ws, null)) state.expanded.add(c.id);
  render();
}

init();
