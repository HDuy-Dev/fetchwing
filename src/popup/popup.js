// Toolbar popup: switch mocks on and off. Reads and writes go through the background worker.

import { popupView, siteStep, filterRows, matchRanges } from '../lib/popup-model.js';
import { grantPath } from '../lib/grant-follow-up.js';
import { el, icon } from '../panel/ui.js';

const UNREACHABLE = 'Could not reach Fetchwing.';
const ALLOW = 'Allow access in the window that opened.';

const $ = id => document.getElementById(id);
const rows = new Map(); // mock id -> row, kept so updates don't drop focus or scroll
let context = { mockSites: [], tabOrigin: null, hasAccess: false };
let latestRead = 0;
let lastView = null;
let query = '';

// Text with the query's matches wrapped in <mark>, built from text nodes only.
function highlight(node, text, q) {
  const parts = [];
  let at = 0;
  for (const [start, end] of matchRanges(text, q)) {
    parts.push(text.slice(at, start), el('mark', {}, text.slice(start, end)));
    at = end;
  }
  parts.push(text.slice(at));
  node.replaceChildren(...parts.filter(p => p !== ''));
}

async function send(msg) {
  const res = await chrome.runtime.sendMessage(msg).catch(() => undefined);
  return res ?? { ok: false, error: UNREACHABLE };
}

async function tabOrigin() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return new URL(tab.url).origin;
  } catch {
    return null;
  }
}

const hasAccess = async origin => /^https?:/.test(origin ?? '')
  && chrome.permissions.contains({ origins: [`${origin}/*`] }).catch(() => false);

function showError(box, message) {
  box.textContent = message ?? '';
  box.hidden = !message;
}

function clearErrors() {
  showError($('topError'), null);
  for (const row of rows.values()) showError(row.error, null);
}

function createRow(id) {
  const row = {
    method: el('span'),
    name: el('span', { class: 'name' }),
    url: el('span'),
    pathText: el('span'),
    status: el('span'),
    input: el('input', { type: 'checkbox', class: 'switch', role: 'switch' }),
    error: el('div', { class: 'error', role: 'alert', hidden: true }),
    busy: false,
    enabled: false,
  };
  row.node = el('li', {},
    el('label', { class: 'row' }, row.method, el('span', { class: 'info' }, row.name, row.url, row.path = el('span', { class: 'path' }, icon('folder'), row.pathText)), row.status, row.input),
    row.error);
  row.input.addEventListener('change', () => toggle(id, row.input.checked));
  return row;
}

function paintRow(row, data) {
  const problem = data.missing.length
    ? `Not running · Unresolved variable${data.missing.length > 1 ? 's' : ''}: ${data.missing.join(', ')}`
    : !data.url.trim() ? 'Not running · No URL' : null;
  row.method.className = `m ${data.method}`;
  row.method.textContent = data.method;
  highlight(row.name, data.name, query);
  row.url.className = problem ? 'url warn' : 'url';
  if (problem) row.url.textContent = problem;
  else highlight(row.url, data.url, query);
  row.path.hidden = !query.trim() || !data.path;
  highlight(row.pathText, data.path, query);
  row.status.className = data.status >= 400 ? 'status bad' : 'status';
  row.status.textContent = String(data.status);
  row.input.setAttribute('aria-label', `Mock ${data.method} ${data.name}, ${data.url}, status ${data.status}${problem ? `, ${problem}` : ''}`);
  row.enabled = data.enabled;
  if (!row.busy) row.input.checked = data.enabled;
}

function paint(view) {
  lastView = view;
  const count = $('count');
  count.textContent = view.rows.length ? `${view.liveCount} on${view.idleCount ? ` · ${view.idleCount} not running` : ''}` : '';
  count.classList.toggle('on', view.liveCount + view.idleCount > 0);
  $('pauseAll').disabled = !(view.liveCount + view.idleCount);

  $('banner').hidden = !view.showBanner;
  $('bannerSite').textContent = (context.tabOrigin ?? '').replace(/^https?:\/\//, '');

  const list = $('list');
  const ids = new Set(view.rows.map(r => r.id));
  for (const [id, row] of rows) {
    if (!ids.has(id)) { row.node.remove(); rows.delete(id); }
  }
  const shown = new Set(filterRows(view.rows, query).map(r => r.id));
  view.rows.forEach((data, index) => {
    if (!rows.has(data.id)) rows.set(data.id, createRow(data.id));
    const row = rows.get(data.id);
    paintRow(row, data);
    row.node.hidden = !shown.has(data.id);
    // Moving a node drops its focus, so only move one that is out of place.
    if (list.children[index] !== row.node) list.insertBefore(row.node, list.children[index] ?? null);
  });

  const searching = Boolean(query.trim());
  $('empty').hidden = view.rows.length > 0;
  $('searchBox').hidden = !view.rows.length;
  $('clearSearch').hidden = !query;
  $('noMatch').hidden = !view.rows.length || shown.size > 0;
  $('noMatchTitle').textContent = `No requests match “${query.trim()}”`;
  $('footer').hidden = !view.rows.length;
  $('footer').replaceChildren(
    searching ? `${shown.size} of ${view.rows.length} requests · ` : '',
    view.siteActive ? 'Active on this site · Env ' : 'Env ', el('b', {}, view.envName));
}

async function refresh() {
  const read = ++latestRead;
  const [res, origin] = await Promise.all([send({ type: 'getWorkspace' }), tabOrigin()]);
  const access = await hasAccess(origin);
  if (read !== latestRead) return;
  if (!res.workspace) return showError($('topError'), res.error ?? UNREACHABLE);
  context = { mockSites: res.mockSites, tabOrigin: origin, hasAccess: access };
  paint(popupView(res.workspace, context));
}

// Gets mocks running on the current tab's site ("Enable here"). Returns an error message, or null.
async function enableSite() {
  const { tabOrigin: origin } = context;
  const step = siteStep({ origin, mockSites: context.mockSites, hasAccess: context.hasAccess });
  if (step === 'grant') {
    // The new window takes focus and usually closes this popup; it finishes the job itself.
    await chrome.windows.create({ url: chrome.runtime.getURL(grantPath(origin)), type: 'popup', width: 440, height: 260 });
    return ALLOW;
  }
  if (step === 'add') {
    const res = await send({ type: 'addMockSite', origin });
    if (!res.ok) return res.error ?? UNREACHABLE;
  }
  return null;
}

async function mutate(mutation) {
  const res = await send({ type: 'mutate', mutation });
  return res.ok ? null : (res.error ?? UNREACHABLE);
}

async function toggle(id, enable) {
  const row = rows.get(id);
  const focused = document.activeElement === row.input;
  clearErrors();
  row.busy = true;
  row.input.disabled = true;
  let error;
  try {
    // The switch only changes the mock; site access is the banner's job, so this always takes effect.
    error = await mutate({ type: 'setMockEnabled', id, enabled: enable });
  } catch {
    error = UNREACHABLE;
  }
  row.busy = false;
  row.input.disabled = false;
  row.input.checked = error ? row.enabled : enable;
  if (focused) row.input.focus();
  showError(row.error, error);
  await refresh();
}

async function runFromHeader(button, action) {
  clearErrors();
  button.disabled = true;
  let error;
  try {
    error = await action();
  } catch {
    error = UNREACHABLE;
  }
  button.disabled = false;
  showError($('topError'), error);
  await refresh();
}

function setQuery(value) {
  query = value;
  $('search').value = value;
  if (lastView) paint(lastView);
}

function clearSearch() {
  setQuery('');
  $('search').focus();
}

$('mark').append(icon('logo'));
$('searchIcon').replaceWith(icon('search'));
$('clearSearch').append(icon('x'));
$('search').addEventListener('input', e => setQuery(e.target.value));
$('search').addEventListener('keydown', e => {
  // With text in the box, Esc clears it instead of closing the popup.
  if (e.key === 'Escape' && query) { e.preventDefault(); e.stopPropagation(); clearSearch(); }
});
$('clearSearch').addEventListener('click', e => { e.preventDefault(); clearSearch(); });
$('noMatchClear').addEventListener('click', clearSearch);
$('pauseAll').append(icon('pause'), 'Pause all');
$('pauseAll').addEventListener('click', e => runFromHeader(e.currentTarget, () => mutate({ type: 'disableAllMocks' })));
$('enableHere').addEventListener('click', e => runFromHeader(e.currentTarget, () => enableSite()));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.workspace || changes.mockSites)) refresh();
});
refresh().then(() => { if (!$('searchBox').hidden) $('search').focus(); });
