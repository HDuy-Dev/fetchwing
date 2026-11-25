// Mock pane: switch, Status / Delay / Content-Type, and a body viewer that toggles to an editor.

import { el, debounce, iconButton, toast } from './ui.js';
import { unknownSiteNotice } from '../lib/editor-window.js';
import { ensureOrigin } from './permissions.js';
import { prettyBody } from './response-view.js';
import { parseJson, renderJsonView } from './json-view.js';
import { editorText, replaceEmbedded, unpackBody, packBody, pathLabel } from '../lib/json-text.js';

const DROP_HEADERS = new Set(['content-length', 'content-encoding', 'transfer-encoding', 'connection', 'keep-alive', 'set-cookie', 'date']);

export function mockFromResponse(r) {
  return {
    status: r.status,
    headers: r.headers.filter(([k]) => !DROP_HEADERS.has(k.toLowerCase())).map(([key, value]) => ({ key, value })),
    body: prettyBody(r.bodyText).text,
  };
}

import { send } from './runtime.js';
import { GONE_ERROR } from '../lib/runtime-send.js';
const host = origin => origin.replace(/^https?:\/\//, '');
let current = null; // { id, refresh(item, state) }

// Turns a mock on/off. Turning on also lets mocks run on the inspected page's site.
// Returns an error message, or null.
export async function setMockOn(id, enable, state) {
  if (enable) {
    const origin = state.inspectedOrigin;
    if (origin && /^https?:/.test(origin) && !state.mockSites.includes(origin)) {
      const access = await ensureOrigin(origin);
      if (access === 'gone') return GONE_ERROR;
      if (access === 'pending') return 'Allow access in the window that opened, then turn the mock on again.';
      if (access !== 'granted') return `Fetchwing needs permission to run on ${origin} to mock its requests.`;
      await send({ type: 'addMockSite', origin });
    }
  }
  const res = await send({ type: 'mutate', mutation: { type: 'setMockEnabled', id, enabled: enable } });
  if (!res?.ok) return res?.error ?? 'Could not change the mock.';
  const notice = enable ? unknownSiteNotice({ isEditorWindow: state.isEditorWindow, origin: state.inspectedOrigin }) : null;
  if (notice) toast(notice, 8000);
  return null;
}

export function renderMockEditor(pane, item, state) {
  // Rebuilding would lose the caret, or an edit not yet saved; only refresh the switch.
  if (current?.id === item.id && (pane.contains(document.activeElement) || current.holdsEdit())) {
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

  // Set while the body, or one JSON string in it, is edited and saved only on Done:
  // { path (null for the whole body), line, startText, base, changedOutside }
  let openEdit = null;
  const stored = structuredClone(draft);
  const inputs = {}; // set once the fields below are built

  const refresh = (it, st) => {
    // The mock can change under an open edit (sync, "Mock this response"):
    // take the new values, so Done applies onto them instead of bringing old ones back.
    // A field still waiting to be saved is newer than what is stored, so it stays.
    for (const key of Object.keys(stored)) {
      if (JSON.stringify(it.mock[key]) === JSON.stringify(stored[key])) continue;
      stored[key] = structuredClone(it.mock[key]);
      if (key === 'body' && openEdit && it.mock.body !== openEdit.base) openEdit.changedOutside = true;
      if (!openEdit || save.isPending()) continue;
      draft[key] = structuredClone(it.mock[key]);
      if (key === 'headers') inputs.headers.value = ctHeader()?.value ?? '';
      else if (inputs[key]) inputs[key].value = draft[key];
    }
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
  area.addEventListener('input', () => {
    if (openEdit) return showEditError(null); // a warning no longer describes the text
    draft.body = area.value;
    save();
  });
  const barTitle = el('span', { class: 'hint edit-title' }, 'Body');
  const cancelBtn = el('button', { type: 'button', class: 'btn', hidden: true }, 'Cancel');
  const doneBtn = el('button', { type: 'button', class: 'btn', hidden: true }, 'Done');
  const editError = el('div', { class: 'mock-error edit-error', role: 'alert', hidden: true });
  const forceBtn = el('button', { type: 'button', class: 'btn', hidden: true }, 'Save anyway');
  const showEditError = (msg, { canForce = false } = {}) => {
    editError.textContent = msg ?? '';
    editError.hidden = !msg;
    forceBtn.hidden = !canForce;
  };
  let editing = false;
  const drawBody = () => {
    const label = openEdit ? `Editing: ${openEdit.path ? pathLabel(openEdit.path) : 'body'}` : 'Body';
    barTitle.textContent = barTitle.title = label;
    area.setAttribute('aria-label', openEdit ? label : 'Mock body');
    cancelBtn.hidden = doneBtn.hidden = !openEdit;
    if (openEdit) {
      viewBox.hidden = foldBtn.hidden = editBtn.hidden = true;
      area.hidden = false;
      area.value = openEdit.startText;
      return;
    }
    const value = parseJson(draft.body);
    const asText = editing || !value;
    viewBox.hidden = asText;
    area.hidden = !asText;
    foldBtn.hidden = asText;
    editBtn.setAttribute('aria-pressed', String(editing));
    editBtn.hidden = !value && !editing;
    if (asText) area.value = draft.body;
    else renderJsonView(viewBox, value, { toggleButton: foldBtn, onEditString: startEdit });
  };
  const startEdit = (path, line = null) => {
    if (save.isPending()) save.flush();
    const startText = path ? editorText(draft.body, path) : unpackBody(draft.body);
    openEdit = { path, line, startText, base: draft.body, changedOutside: false };
    drawBody();
    area.focus();
    area.setSelectionRange(0, 0);
    area.scrollTop = 0;
  };
  const endEdit = () => {
    const { line } = openEdit;
    openEdit = null;
    showEditError(null);
    drawBody();
    // A string's button is gone if its block is folded away or the body changed shape.
    const stringBtn = line === null ? null : viewBox.querySelector(`[data-edit="${line}"]`);
    (stringBtn ?? (editBtn.hidden ? area : editBtn)).focus();
  };
  const finishEdit = ({ force = false } = {}) => {
    if (area.value === openEdit.startText) return endEdit();
    const { path, base, changedOutside } = openEdit;
    // One string is put into the latest body; a whole body is rebuilt from the one it came from.
    const result = path ? replaceEmbedded(draft.body, path, area.value) : packBody(base, area.value);
    if (result.error) return showEditError(result.error);
    if (!path && !force) {
      const doubts = [];
      if (changedOutside) doubts.push('The mock body changed while you were editing; saving replaces it.');
      if (result.warnings.length) doubts.push(`These JSON strings may not be saved as strings: ${result.warnings.join(', ')}`);
      if (doubts.length) return showEditError(doubts.join(' '), { canForce: true });
    }
    if (result.body !== draft.body) {
      draft.body = result.body;
      save.flush();
    }
    endEdit();
  };
  cancelBtn.addEventListener('click', endEdit);
  doneBtn.addEventListener('click', () => finishEdit());
  forceBtn.addEventListener('click', () => finishEdit({ force: true }));
  editBtn.addEventListener('click', () => {
    // An object or array body is edited formatted, with its JSON strings opened up.
    if (!editing && parseJson(draft.body)) return startEdit(null);
    editing = !editing;
    drawBody();
    if (editing) area.focus();
  });

  const statusField = numberField('Status', draft.status, { min: '100', max: '599', onValue: n => { if (Number.isInteger(n) && n >= 100 && n <= 599) { draft.status = n; save(); } } });
  const delayField = numberField('Delay', draft.delayMs, { min: '0', max: '60000', step: '100', suffix: 'ms', onValue: n => { if (Number.isFinite(n) && n >= 0) { draft.delayMs = Math.min(60000, Math.round(n)); save(); } } });
  Object.assign(inputs, { status: statusField.querySelector('input'), delayMs: delayField.querySelector('input'), headers: ctInput });

  pane.className = 'pane mockpane';
  pane.append(
    el('div', { class: 'mockbar' }, el('label', { style: 'display:flex;align-items:center;gap:12px' }, switchInput, label), site),
    errorEl,
    el('div', { class: 'fields' },
      statusField,
      delayField,
      el('label', { class: 'field grow' }, 'Content-Type', ctInput)),
    el('div', { class: 'editor' },
      el('div', { class: 'editor-bar' }, barTitle, el('div', { class: 'tool-icons ml-auto' }, foldBtn, editBtn, cancelBtn, doneBtn)),
      el('div', { class: 'edit-alert' }, editError, forceBtn), viewBox, area),
  );
  drawBody();
  refresh(item, state);
  current = { id: item.id, refresh, holdsEdit: () => openEdit !== null && pane.contains(area) };
}
