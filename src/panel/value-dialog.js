// The large editor for one environment variable's value.

import { jsonState, openText, savedText, hasUnsafeNumber, indentAt, saveCheck } from '../lib/env-value.js';
import { formatJson, parseEmbedded } from '../lib/json-text.js';
import { renderJsonView } from './json-view.js';
import { el, openDialog, debounce } from './ui.js';

const MAC = /Mac/.test(globalThis.navigator?.platform ?? '');
const CHANGED = 'The value changed while you were editing. Saving replaces it.';
const GONE = 'This variable no longer exists. Copy your text before closing.';

// opts: { title, envName, value, secret, current(): string|null, save(text): Promise<boolean>, onClosed() }
export function openValueDialog({ title, envName, value, secret, current, save, onClosed }) {
  let hidden = Boolean(secret);
  let asking = false;
  let busy = false;
  let warned = null; // the outside value the user was told about
  const opened = openText(value);

  // A hidden secret is not put anywhere in the page.
  const area = el('textarea', { class: 'value-text', spellcheck: 'false', 'aria-label': 'Value' });
  const tree = el('div', { class: 'value-tree', hidden: true });
  const treeNote = el('div', { class: 'value-note', hidden: true }, 'Large numbers are rounded here. Edit shows the exact text.');
  const jsonMessage = el('div', { class: 'value-message', role: 'status' });
  const notice = el('div', { class: 'value-notice', role: 'alert' });
  const status = el('span', { class: 'value-status' });
  const tab = (label, on) => el('button', { type: 'button', class: 'value-tab', 'aria-pressed': String(on) }, label);
  const editTab = tab('Edit', true);
  const treeTab = tab('Tree', false);
  const formatBtn = el('button', { type: 'button', class: 'btn' }, 'Format');
  const showBtn = el('button', { type: 'button', class: 'btn' }, 'Show value');
  const masked = el('div', { class: 'value-masked' }, el('span', {}, 'This value is secret and hidden.'), showBtn);
  const editor = el('div', { class: 'editor' },
    el('div', { class: 'value-bar' }, editTab, treeTab, el('span', { class: 'value-grow' }), status, formatBtn),
    masked, area, treeNote, tree, jsonMessage);

  const saveBtn = el('button', { type: 'button', class: 'btn-primary' }, 'Save');
  const cancelBtn = el('button', { type: 'button', class: 'btn' }, 'Cancel');
  const foot = el('div', { class: 'actions' });
  const keepBtn = el('button', { type: 'button', class: 'btn' }, 'Keep editing');
  const discardBtn = el('button', { type: 'button', class: 'btn danger' }, 'Discard');
  const ask = el('div', { class: 'value-ask', role: 'alertdialog', 'aria-label': 'Discard changes?', hidden: true },
    el('span', {}, 'Discard changes?'), el('span', { class: 'value-ask-buttons' }, keepBtn, discardBtn));

  const dirty = () => !hidden && area.value !== opened;

  function drawStatus() {
    const state = hidden ? null : jsonState(area.value);
    status.className = `value-status${state && !state.valid ? ' bad' : ''}`;
    status.textContent = !state ? '' : state.valid ? '✓ Valid JSON' : '✕ Invalid JSON';
    jsonMessage.textContent = state && !state.valid ? `${state.message.replace(/\.?$/, '.')} You can still save.` : '';
    formatBtn.disabled = !state?.valid || area.hidden;
    treeTab.disabled = hidden || !parseEmbedded(area.value);
  }
  const redrawStatus = debounce(drawStatus, 300);

  function showTree(on) {
    redrawStatus.cancel();
    const parsed = on ? parseEmbedded(area.value) : null;
    const asTree = Boolean(parsed);
    area.hidden = asTree;
    tree.hidden = !asTree;
    treeNote.hidden = !asTree || !hasUnsafeNumber(area.value);
    editTab.setAttribute('aria-pressed', String(!asTree));
    treeTab.setAttribute('aria-pressed', String(asTree));
    if (asTree) renderJsonView(tree, parsed);
    drawStatus();
  }

  function drawHidden() {
    masked.hidden = !hidden;
    area.hidden = hidden;
    editTab.disabled = hidden;
    const hint = el('span', { class: 'hint value-keys' }, `${MAC ? '⌘ Enter' : 'Ctrl+Enter'} to save`);
    cancelBtn.textContent = hidden ? 'Close' : 'Cancel';
    foot.replaceChildren(...(hidden ? [cancelBtn] : [hint, cancelBtn, saveBtn]));
    drawStatus();
  }

  function focusEditor() {
    area.focus();
    area.setSelectionRange(0, 0);
    area.scrollTop = 0;
  }

  function reveal() {
    hidden = false;
    area.value = opened;
    drawHidden();
    focusEditor();
  }

  function showAsk(on) {
    asking = on;
    ask.hidden = !on;
    foot.hidden = on;
    if (on) keepBtn.focus();
    else if (!area.hidden) area.focus();
    else treeTab.focus();
  }

  // Replacing the selection this way keeps the browser's undo working.
  const type = text => document.execCommand('insertText', false, text);

  let close;
  async function submit() {
    if (busy || hidden || asking) return;
    const now = current();
    const check = saveCheck(value, now, warned !== null && now === warned);
    if (check === 'gone') {
      notice.textContent = GONE;
      return;
    }
    if (check === 'changed') {
      warned = now;
      notice.textContent = CHANGED;
      saveBtn.textContent = 'Save anyway';
      return;
    }
    busy = true;
    try {
      if (await save(savedText(value, area.value))) close();
    } finally {
      busy = false;
    }
  }

  area.addEventListener('input', () => redrawStatus());
  area.addEventListener('keydown', e => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key !== 'Enter' || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    type(`\n${indentAt(area.value, area.selectionStart)}`);
  });
  editTab.addEventListener('click', () => showTree(false));
  treeTab.addEventListener('click', () => showTree(true));
  formatBtn.addEventListener('click', () => {
    if (!jsonState(area.value)?.valid) return drawStatus();
    const formatted = formatJson(area.value, 2);
    area.focus();
    area.select();
    type(formatted);
    area.setSelectionRange(0, 0);
    area.scrollTop = 0;
    redrawStatus.cancel();
    drawStatus();
  });
  showBtn.addEventListener('click', reveal);
  saveBtn.addEventListener('click', submit);
  keepBtn.addEventListener('click', () => showAsk(false));

  const heading = el('h2', { id: 'valueDialogTitle' }, title || 'Value', ' ', el('small', {}, `· ${envName}`));

  const result = openDialog((box, done) => {
    close = done;
    box.setAttribute('aria-labelledby', 'valueDialogTitle');
    cancelBtn.addEventListener('click', done);
    discardBtn.addEventListener('click', done);
    box.addEventListener('keydown', e => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        submit();
        return;
      }
      if (e.key !== 'Tab') return;
      const stops = [...box.querySelectorAll('button, textarea')].filter(n => !n.disabled && n.getClientRects().length);
      const edge = e.shiftKey ? stops[0] : stops.at(-1);
      if (document.activeElement !== edge) return;
      e.preventDefault();
      (e.shiftKey ? stops.at(-1) : stops[0]).focus();
    });
    box.append(heading, editor, notice, foot, ask);
  }, {
    className: 'dialog value-dialog',
    // Escape while the question is up goes back to editing; anything else leaves it up.
    canClose: reason => {
      if (!dirty()) return true;
      showAsk(reason === 'escape' ? !asking : true);
      return false;
    },
    onClosed: () => {
      redrawStatus.cancel();
      onClosed?.();
    },
  });
  if (!result) return null;
  if (!hidden) area.value = opened;
  drawHidden();
  if (hidden) showBtn.focus();
  else focusEditor();
  return result;
}
