// Mock pane: switch, Status / Delay / Content-Type, and a body viewer that toggles to an editor.

import { el, debounce, iconButton } from './ui.js';
import { ensureOrigin } from './permissions.js';
import { prettyBody } from './response-view.js';
import { parseJson, renderJsonView } from './json-view.js';

const DROP_HEADERS = new Set(['content-length', 'content-encoding', 'transfer-encoding', 'connection', 'keep-alive', 'set-cookie', 'date']);

export function mockFromResponse(r) {
  return {
    status: r.status,
    headers: r.headers.filter(([k]) => !DROP_HEADERS.has(k.toLowerCase())).map(([key, value]) => ({ key, value })),
    body: prettyBody(r.bodyText).text,
  };
}

const send = msg => chrome.runtime.sendMessage(msg);
const host = origin => origin.replace(/^https?:\/\//, '');
let current = null; // { id, refresh(item, state) }

// Turns a mock on/off. Turning on also lets mocks run on the inspected page's site.
// Returns an error message, or null.
export async function setMockOn(id, enable, state) {
  if (enable) {
    const origin = state.inspectedOrigin;
    if (origin && /^https?:/.test(origin) && !state.mockSites.includes(origin)) {
      const access = await ensureOrigin(origin);
      if (access === 'pending') return 'Allow access in the window that opened, then turn the mock on again.';
      if (access !== 'granted') return `Fetchwing needs permission to run on ${origin} to mock its requests.`;
      await send({ type: 'addMockSite', origin });
    }
  }
  const res = await send({ type: 'mutate', mutation: { type: 'setMockEnabled', id, enabled: enable } });
  return res?.ok ? null : (res?.error ?? 'Could not change the mock.');
}

export function renderMockEditor(pane, item, state) {
  // Rebuilding while the user types would lose the caret; only refresh the switch.
  if (current?.id === item.id && pane.contains(document.activeElement)) {
    current.refresh(item, state);
    return;
  }
  pane.textContent = '';
  const draft = structuredClone({ status: item.mock.status, headers: item.mock.headers, body: item.mock.body, delayMs: item.mock.delayMs });
  const save = debounce(() => send({ type: 'mutate', mutation: { type: 'updateMock', id: item.id, patch: structuredClone(draft) } }), 300);

  const switchInput = el('input', { type: 'checkbox', class: 'switch', role: 'switch', 'aria-label': 'Mock on' });
  const label = el('span', { class: 'mock-label' });
  const site = el('span', { class: 'hint mono ml-auto' });
  const errorEl = el('div', { class: 'mock-error', role: 'alert', hidden: true });

  const refresh = (it, st) => {
    switchInput.checked = it.mock.enabled;
    label.textContent = it.mock.enabled ? 'Mock on' : 'Mock off';
    label.classList.toggle('on', it.mock.enabled);
    site.textContent = st.mockSites.map(host).join(', ');
    label.title = it.mock.enabled
      ? (st.mockSites.length ? `Pages on ${st.mockSites.map(host).join(', ')} get this response instead of the real API` : 'No site set up yet: open your web app in this tab and turn the mock on again')
      : 'When on, pages calling this method and URL get this response';
  };
  const showError = msg => { errorEl.textContent = msg; errorEl.hidden = !msg; };

  switchInput.addEventListener('change', async () => {
    showError('');
    const enable = switchInput.checked;
    if (enable) save.flush();
    const error = await setMockOn(item.id, enable, state);
    if (error) {
      switchInput.checked = !enable;
      showError(error);
    }
  });

  const numberField = (labelText, value, { min, max, step, onValue, suffix }) => {
    const input = el('input', { type: 'number', min, max, step, value, 'aria-label': labelText });
    input.addEventListener('input', () => onValue(Number(input.value)));
    return el('label', { class: 'field' }, suffix ? `${labelText} (${suffix})` : labelText, input);
  };
  const ctHeader = () => draft.headers.find(h => h.key.toLowerCase() === 'content-type');
  const ctInput = el('input', { type: 'text', value: ctHeader()?.value ?? '', placeholder: 'application/json', 'aria-label': 'Content-Type', spellcheck: 'false' });
  ctInput.addEventListener('input', () => {
    const h = ctHeader();
    if (h) h.value = ctInput.value;
    else draft.headers.push({ key: 'Content-Type', value: ctInput.value });
    if (!ctInput.value) draft.headers = draft.headers.filter(x => x.key.toLowerCase() !== 'content-type');
    save();
  });

  // Body: foldable JSON view, or a textarea when editing (or when the body isn't JSON).
  const foldBtn = iconButton('collapse', 'Collapse all', null);
  const editBtn = iconButton('edit', 'Edit body', null, { 'aria-pressed': 'false' });
  const viewBox = el('div', { 'aria-label': 'Mock body' });
  const area = el('textarea', { class: 'mock-text', spellcheck: 'false', 'aria-label': 'Mock body', placeholder: '{ "message": "mocked" }' });
  area.addEventListener('input', () => { draft.body = area.value; save(); });
  let editing = false;
  const drawBody = () => {
    const value = parseJson(draft.body);
    const asText = editing || !value;
    viewBox.hidden = asText;
    area.hidden = !asText;
    foldBtn.hidden = asText;
    editBtn.setAttribute('aria-pressed', String(editing));
    editBtn.hidden = !value && !editing;
    if (asText) area.value = draft.body;
    else renderJsonView(viewBox, value, { toggleButton: foldBtn });
  };
  editBtn.addEventListener('click', () => {
    editing = !editing;
    drawBody();
    if (editing) area.focus();
  });

  pane.className = 'pane mockpane';
  pane.append(
    el('div', { class: 'mockbar' }, el('label', { style: 'display:flex;align-items:center;gap:12px' }, switchInput, label), site),
    errorEl,
    el('div', { class: 'fields' },
      numberField('Status', draft.status, { min: '100', max: '599', onValue: n => { if (Number.isInteger(n) && n >= 100 && n <= 599) { draft.status = n; save(); } } }),
      numberField('Delay', draft.delayMs, { min: '0', max: '60000', step: '100', suffix: 'ms', onValue: n => { if (Number.isFinite(n) && n >= 0) { draft.delayMs = Math.min(60000, Math.round(n)); save(); } } }),
      el('label', { class: 'field grow' }, 'Content-Type', ctInput)),
    el('div', { class: 'editor' },
      el('div', { class: 'editor-bar' }, el('span', { class: 'hint' }, 'Body'), el('div', { class: 'tool-icons ml-auto' }, foldBtn, editBtn)),
      viewBox, area),
  );
  drawBody();
  refresh(item, state);
  current = { id: item.id, refresh };
}
