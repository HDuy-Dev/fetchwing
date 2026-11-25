// Mock pane: switch, Status / Delay / Content-Type, and a body viewer that toggles to an editor.

import { el, debounce, iconButton } from './ui.js';
import { ensureOrigin } from './permissions.js';
import { prettyBody } from './response-view.js';
import { parseJson, renderJsonView } from './json-view.js';
import { editorText, replaceEmbedded, pathLabel } from '../lib/json-text.js';

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
  return res?.ok ? null : (res?.error ?? 'Could not change the mock.');
}

export function renderMockEditor(pane, item, state) {
  // Rebuilding would lose the caret, or a string being edited; only refresh the switch.
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

  // Set while one JSON string of the body is being edited:
  // { path, line, startText }
  let stringEdit = null;
  const stored = structuredClone(draft);
  const inputs = {}; // set once the fields below are built

  const refresh = (it, st) => {
    // The mock can change under an open string edit (sync, "Mock this response"):
    // take the new values, so Done applies onto them instead of bringing old ones back.
    // A field still waiting to be saved is newer than what is stored, so it stays.
    for (const key of Object.keys(stored)) {
      if (JSON.stringify(it.mock[key]) === JSON.stringify(stored[key])) continue;
      stored[key] = structuredClone(it.mock[key]);
      if (!stringEdit || save.isPending()) continue;
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
  area.addEventListener('input', () => { if (!stringEdit) { draft.body = area.value; save(); } });
  const barTitle = el('span', { class: 'hint edit-title' }, 'Body');
  const cancelBtn = el('button', { type: 'button', class: 'btn', hidden: true }, 'Cancel');
  const doneBtn = el('button', { type: 'button', class: 'btn', hidden: true }, 'Done');
  const editError = el('div', { class: 'mock-error edit-error', role: 'alert', hidden: true });
  const showEditError = msg => { editError.textContent = msg ?? ''; editError.hidden = !msg; };
  let editing = false;
  const drawBody = () => {
    const label = stringEdit ? `Editing: ${pathLabel(stringEdit.path)}` : 'Body';
    barTitle.textContent = barTitle.title = label;
    area.setAttribute('aria-label', stringEdit ? label : 'Mock body');
    cancelBtn.hidden = doneBtn.hidden = !stringEdit;
    if (stringEdit) {
      viewBox.hidden = foldBtn.hidden = editBtn.hidden = true;
      area.hidden = false;
      area.value = stringEdit.startText;
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
    else renderJsonView(viewBox, value, { toggleButton: foldBtn, onEditString: startStringEdit });
  };
  const startStringEdit = (path, line) => {
    if (save.isPending()) save.flush();
    stringEdit = { path, line, startText: editorText(draft.body, path) };
    drawBody();
    area.focus();
    area.setSelectionRange(0, 0);
    area.scrollTop = 0;
  };
  const endStringEdit = () => {
    const { line } = stringEdit;
    stringEdit = null;
    showEditError(null);
    drawBody();
    // The button is gone if its block is folded away or the body changed shape.
    (viewBox.querySelector(`[data-edit="${line}"]`) ?? (editBtn.hidden ? area : editBtn)).focus();
  };
  cancelBtn.addEventListener('click', endStringEdit);
  doneBtn.addEventListener('click', () => {
    if (area.value !== stringEdit.startText) {
      const result = replaceEmbedded(draft.body, stringEdit.path, area.value);
      if (result.error) return showEditError(result.error);
      if (result.body !== draft.body) {
        draft.body = result.body;
        save.flush();
      }
    }
    endStringEdit();
  });
  editBtn.addEventListener('click', () => {
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
      editError, viewBox, area),
  );
  drawBody();
  refresh(item, state);
  current = { id: item.id, refresh, holdsEdit: () => stringEdit !== null && pane.contains(area) };
}
