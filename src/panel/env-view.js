// One environment, shown in its own tab: name, actions and the variable table.

import { hintName, envPatch, sameEnv, savableVars } from '../lib/env-form.js';
import { isLargeValue, valueSummary, pastedValue, findVar } from '../lib/env-value.js';
import { openValueDialog } from './value-dialog.js';
import { el, icon, iconButton, debounce } from './ui.js';

// opts: { getWs, mutate, send, onDuplicate(id), onPendingChange() }
export function createEnvView(container, env, { getWs, mutate, send, onDuplicate, onPendingChange }) {
  const envId = env.id;
  const current = () => {
    const found = getWs().environments[envId];
    return found && !found.deleted ? found : null;
  };
  // Edits: the save waiting to run, the saves on their way, and the last one sent.
  let saving = Promise.resolve();
  let inFlight = 0;
  let confirming = false;
  let vars = [];
  let savedName = env.name;

  const save = debounce(() => {
    const patch = envPatch(nameInput.value, vars);
    if (patch.name !== undefined) savedName = patch.name.trim();
    inFlight++;
    saving = mutate({ type: 'updateEnvironment', id: envId, patch }).finally(() => {
      inFlight--;
      onPendingChange();
    });
    onPendingChange();
  }, 300);

  function changed() {
    save();
    onPendingChange();
  }

  // Sends what is still waiting.
  async function flush() {
    if (save.isPending()) save.flush();
    await saving;
  }

  const nameInput = el('input', { type: 'text', class: 'env-name', value: env.name, 'aria-label': 'Environment name' });
  const nameError = el('div', { class: 'err', role: 'alert' });
  nameInput.addEventListener('input', () => {
    nameError.textContent = nameInput.value.trim() ? '' : 'Name can\'t be empty';
    changed();
  });
  nameInput.addEventListener('blur', () => {
    if (nameInput.value.trim() || !nameInput.isConnected) return;
    nameInput.value = savedName;
    nameError.textContent = '';
  });

  const hint = el('p', { class: 'hint env-hint' });
  const drawHint = () => {
    hint.replaceChildren('Type ', el('code', { class: 'mono' }, `{{${hintName(vars)}}}`), ' in a URL, header or body. Secret values stay on this device.');
  };

  const rows = el('div', { class: 'env-rows' });

  // A row is the blank one until it is typed in; it then becomes a variable
  // in place (the caret stays put) and a new blank row follows it.
  function varRow(v, isBlank) {
    const edit = (field, value) => {
      v[field] = value;
      if (isBlank) {
        isBlank = false;
        vars.push(v);
        keyInput.placeholder = 'Variable';
        actions.replaceChildren(openBtn, lock, remove);
        rows.append(varRow({ key: '', value: '', secret: false }, true));
      }
      drawOpen();
      drawHint();
      changed();
    };
    const keyInput = el('input', { type: 'text', value: v.key, placeholder: isBlank ? 'Add variable…' : 'Variable', 'aria-label': 'Variable name', spellcheck: 'false', oninput: e => edit('key', e.target.value) });
    // A large value shows as a summary that opens the editor. The choice is made when
    // the row is drawn or pasted into, never while the user is typing.
    const isChip = isLargeValue(v.value);
    const valueCell = isChip
      ? el('button', { type: 'button', class: 'env-chip', onclick: () => openEditor(v) })
      : el('input', { type: v.secret ? 'password' : 'text', value: v.value, placeholder: 'Value', 'aria-label': 'Value', spellcheck: 'false', oninput: e => edit('value', e.target.value), onpaste: paste });
    const drawChip = () => {
      const { kind, size, preview } = valueSummary(v.value, v.secret);
      valueCell.setAttribute('aria-label', `Edit value of ${v.key || 'unnamed variable'}`);
      valueCell.replaceChildren(el('b', {}, kind), el('span', {}, size), el('i', {}, preview));
    };
    // A chip opens the editor itself, so its row only keeps the button's place.
    const openBtn = isChip
      ? el('span', { class: 'env-gap', 'aria-hidden': 'true' })
      : iconButton('maximize', 'Open in editor', () => openEditor(v), { class: 'ibtn env-hover env-open' });
    const drawOpen = () => {
      if (isChip) drawChip();
      else openBtn.classList.toggle('env-off', !v.key && !v.value);
    };
    function paste(e) {
      const next = pastedValue(valueCell.value, valueCell.selectionStart, valueCell.selectionEnd, e.clipboardData.getData('text/plain'));
      if (next === null) return;
      e.preventDefault();
      edit('value', next);
      redrawRow(row, v).querySelector('.env-chip')?.focus();
    }
    const lock = iconButton(v.secret ? 'lock' : 'unlock', 'Secret: stays on this device, never synced', () => {
      v.secret = !v.secret;
      if (isChip) drawChip();
      else valueCell.type = v.secret ? 'password' : 'text';
      lock.setAttribute('aria-pressed', String(v.secret));
      lock.replaceChildren(icon(v.secret ? 'lock' : 'unlock'));
      changed();
    }, { 'aria-pressed': String(v.secret) });
    const remove = iconButton('x', 'Remove variable', () => {
      const index = vars.indexOf(v);
      vars.splice(index, 1);
      row.remove();
      rows.children[index]?.querySelector('input')?.focus();
      drawHint();
      changed();
    });
    const actions = el('div', { class: 'env-row-actions' }, isBlank ? null : [openBtn, lock, remove]);
    const row = el('div', { class: 'env-row' }, keyInput, valueCell, actions);
    drawOpen();
    return row;
  }

  function redrawRow(row, v) {
    const next = varRow(v, false);
    row.replaceWith(next);
    return next;
  }

  // The dialog saves into the latest workspace, so it works even if this tab is gone.
  async function openEditor(v) {
    const index = savableVars(vars).indexOf(v);
    const target = { key: v.key, value: v.value, index, unique: vars.filter(x => x.key === v.key).length === 1 };
    const { secret } = v;
    await flush();
    const latest = () => {
      const env = current();
      const at = env ? findVar(env.vars, target) : -1;
      return at < 0 ? null : { env, at };
    };
    openValueDialog({
      title: target.key,
      envName: current()?.name ?? savedName,
      value: target.value,
      secret,
      current: () => {
        const found = latest();
        return found ? found.env.vars[found.at].value : null;
      },
      save: async text => {
        const found = latest();
        if (!found) return false;
        if (found.env.vars[found.at].value === text) return true;
        const next = found.env.vars.map((x, i) => (i === found.at ? { ...x, value: text } : x));
        inFlight++;
        const sent = mutate({ type: 'updateEnvironment', id: envId, patch: { vars: next } });
        saving = sent.finally(() => {
          inFlight--;
          onPendingChange();
        });
        onPendingChange();
        const res = await sent;
        if (res?.ok) showSaved(target, text);
        return Boolean(res?.ok);
      },
      // Back to the row it was opened from, if it is still on screen.
      onClosed: () => rows.children[index]?.querySelector('.env-chip, .env-open')?.focus(),
    });
  }

  // Puts the dialog's value into its row now, so the redraw that follows the save
  // finds nothing new and leaves the focus alone.
  function showSaved(target, text) {
    const at = findVar(vars, target);
    if (at < 0 || !rows.children[at]) return;
    vars[at].value = text;
    redrawRow(rows.children[at], vars[at]);
  }

  // Fills the name and the table from a saved environment.
  function load(saved) {
    vars = structuredClone(saved.vars);
    savedName = saved.name;
    nameInput.value = saved.name;
    nameError.textContent = '';
    rows.replaceChildren(...vars.map(v => varRow(v, false)), varRow({ key: '', value: '', secret: false }, true));
    drawHint();
  }

  const head = el('div', { class: 'env-head' });
  const activeSlot = el('span', { class: 'env-active-slot' });
  let shownActive = null;
  // Only the slot is replaced, so the name field keeps its focus and caret.
  const drawActive = () => {
    shownActive = envId === getWs().activeEnvId;
    const hadFocus = activeSlot.contains(document.activeElement);
    activeSlot.replaceChildren(shownActive
      ? el('span', { class: 'env-active' }, icon('check'), 'Active')
      : el('button', { type: 'button', class: 'btn env-set-active', onclick: () => mutate({ type: 'setActiveEnv', id: envId }) }, 'Set active'));
    // The pressed button is gone; the keyboard moves on to the next action.
    if (hadFocus) activeSlot.nextElementSibling.focus();
  };
  const drawHead = () => {
    head.replaceChildren(
      nameInput,
      activeSlot,
      iconButton('copy', 'Duplicate', () => onDuplicate(envId)),
      iconButton('trash', 'Delete', confirmDelete, { class: 'ibtn env-delete' }),
    );
    drawActive();
  };

  function confirmDelete() {
    confirming = true;
    const cancel = el('button', { type: 'button', class: 'btn', onclick: () => {
      confirming = false;
      drawHead();
      head.querySelector('.env-delete').focus();
    } }, 'Cancel');
    head.replaceChildren(el('div', { class: 'env-confirm', role: 'alertdialog', 'aria-label': 'Delete environment' },
      el('span', {}, `Delete ${savedName}? Its variables will be removed.`),
      cancel,
      el('button', { type: 'button', class: 'btn danger', onclick: async () => {
        save.cancel();
        await saving;
        await mutate({ type: 'deleteEnvironment', id: envId });
      } }, 'Delete')));
    cancel.focus();
  }

  load(env);
  drawHead();
  container.replaceChildren(
    head,
    nameError,
    el('div', { class: 'env-row env-columns', 'aria-hidden': 'true' }, el('span', {}, 'Variable'), el('span', {}, 'Value'), el('span', { class: 'env-row-actions' })),
    rows,
    hint,
    el('span', { class: 'hint env-saved' }, icon('check'), 'Saved automatically'),
  );

  return {
    envId,
    flush,
    isPending: () => save.isPending() || inFlight > 0,
    // Redraws only what differs, so typing keeps its focus and caret.
    update(ws) {
      const saved = current();
      if (!saved) return;
      if (!confirming && shownActive !== (envId === ws.activeEnvId)) drawActive();
      if (!save.isPending() && !inFlight && !sameEnv(nameInput.value, vars, saved)) load(saved);
    },
    addVar(name) {
      const v = { key: name, value: '', secret: false };
      vars.push(v);
      const row = varRow(v, false);
      rows.insertBefore(row, rows.lastElementChild);
      drawHint();
      changed();
      row.querySelectorAll('input')[1]?.focus();
    },
    focusName() {
      nameInput.focus();
      nameInput.select();
    },
    // Called when the tab is left or the environment is gone.
    destroy() {
      if (current()) { if (save.isPending()) save.flush(); }
      else save.cancel();
      container.replaceChildren();
    },
  };
}
