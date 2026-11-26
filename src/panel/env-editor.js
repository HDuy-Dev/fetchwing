// Environments dialog: list on the left, variables of the chosen one on the right.

import { newId, liveEnvironments } from '../lib/model.js';
import { copyName, hintName, envPatch } from '../lib/env-form.js';
import { el, icon, iconButton, openDialog, debounce } from './ui.js';
import { mutate } from './panel.js';

// opts: { envId?, addVar? } — open on one environment, optionally with a new variable row.
export function openEnvironments(state, { envId, addVar } = {}) {
  let chosen = envId ?? state.ws.activeEnvId ?? liveEnvironments(state.ws)[0]?.id ?? null;
  let pendingVar = addVar ?? null;
  let initialFocus = null;
  // Edits of the shown environment: the save waiting to run, and the last one sent.
  let saver = null;
  let saving = Promise.resolve();

  openDialog((box, close) => {
    const list = el('div', { class: 'env-list' });
    const editor = el('div', { class: 'env-editor' });

    async function refreshFromStorage() {
      const { workspace } = await chrome.storage.local.get('workspace');
      if (workspace) state.ws = workspace;
    }

    // Sends what is still waiting, so redrawing from storage can't lose it.
    async function flush() {
      if (saver?.isPending()) saver.flush();
      await saving;
      await refreshFromStorage();
    }

    const redraw = () => { drawList(); drawEditor(); };
    // With no environment left, the button that creates one takes the focus.
    const focusCurrent = () => (list.querySelector('[aria-current="true"]') ?? editor.querySelector('.btn'))?.focus();

    async function choose(id) {
      await flush();
      chosen = id;
      redraw();
    }

    async function add(name, vars = []) {
      await flush();
      const id = newId();
      if (!(await mutate({ type: 'addEnvironment', id, name })).ok) return;
      if (vars.length) await mutate({ type: 'updateEnvironment', id, patch: { vars } });
      await refreshFromStorage();
      chosen = id;
      redraw();
      const nameInput = editor.querySelector('.env-name');
      nameInput?.focus();
      nameInput?.select();
    }

    const drawList = () => {
      list.textContent = '';
      for (const env of liveEnvironments(state.ws)) {
        list.append(el('button', {
          type: 'button',
          class: 'list-row',
          'aria-current': env.id === chosen ? 'true' : undefined,
          onclick: async () => { await choose(env.id); focusCurrent(); },
        }, el('span', { class: 'name' }, env.name),
        env.id === state.ws.activeEnvId ? el('span', { class: 'env-check', role: 'img', title: 'Active', 'aria-label': 'Active' }, icon('check')) : null));
      }
      list.append(el('button', { type: 'button', class: 'list-row env-new', onclick: () => add('New environment') },
        icon('plus'), el('span', { class: 'name' }, 'New environment')));
    };

    const drawEditor = () => {
      editor.textContent = '';
      saver = null;
      const env = state.ws.environments[chosen];
      if (!env || env.deleted) {
        editor.append(el('div', { class: 'env-empty' },
          el('div', { class: 'hint' }, 'Add an environment to define {{variables}}.'),
          el('button', { type: 'button', class: 'btn', onclick: () => add('New environment') }, icon('plus'), 'New environment')));
        return;
      }

      const vars = structuredClone(env.vars);
      let pendingIndex = -1;
      if (pendingVar) {
        pendingIndex = vars.push({ key: pendingVar, value: '', secret: false }) - 1;
        pendingVar = null;
      }

      const nameInput = el('input', { type: 'text', class: 'env-name', value: env.name, 'aria-label': 'Environment name' });
      const nameError = el('div', { class: 'err', role: 'alert' });
      let savedName = env.name;

      const save = debounce(() => {
        const patch = envPatch(nameInput.value, vars);
        saving = mutate({ type: 'updateEnvironment', id: env.id, patch }).then(async res => {
          if (!res?.ok) return;
          const renamed = patch.name !== undefined && patch.name.trim() !== savedName;
          if (!renamed) return;
          savedName = patch.name.trim();
          await refreshFromStorage();
          drawList();
        });
      }, 300);
      saver = save;

      nameInput.addEventListener('input', () => {
        nameError.textContent = nameInput.value.trim() ? '' : 'Name can\'t be empty';
        save();
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
            actions.append(lock, remove);
            rows.append(varRow({ key: '', value: '', secret: false }, true));
          }
          drawHint();
          save();
        };
        const keyInput = el('input', { type: 'text', value: v.key, placeholder: isBlank ? 'Add variable…' : 'Variable', 'aria-label': 'Variable name', spellcheck: 'false', oninput: e => edit('key', e.target.value) });
        const valueInput = el('input', { type: v.secret ? 'password' : 'text', value: v.value, placeholder: 'Value', 'aria-label': 'Value', spellcheck: 'false', oninput: e => edit('value', e.target.value) });
        const lock = iconButton(v.secret ? 'lock' : 'unlock', 'Secret: stays on this device, never synced', () => {
          v.secret = !v.secret;
          valueInput.type = v.secret ? 'password' : 'text';
          lock.setAttribute('aria-pressed', String(v.secret));
          lock.replaceChildren(icon(v.secret ? 'lock' : 'unlock'));
          save();
        }, { 'aria-pressed': String(v.secret) });
        const remove = iconButton('x', 'Remove variable', () => {
          const index = vars.indexOf(v);
          vars.splice(index, 1);
          row.remove();
          rows.children[index]?.querySelector('input')?.focus();
          drawHint();
          save();
        });
        const actions = el('div', { class: 'env-row-actions' }, isBlank ? null : [lock, remove]);
        const row = el('div', { class: 'env-row' }, keyInput, valueInput, actions);
        return row;
      }

      rows.append(...vars.map(v => varRow(v, false)), varRow({ key: '', value: '', secret: false }, true));
      drawHint();
      if (pendingIndex >= 0) {
        initialFocus = rows.children[pendingIndex].querySelectorAll('input')[1];
        save();
      }

      const head = el('div', { class: 'env-head' });
      const drawHead = () => {
        const active = env.id === state.ws.activeEnvId;
        head.replaceChildren(
          nameInput,
          active
            ? el('span', { class: 'env-active' }, icon('check'), 'Active')
            : el('button', { type: 'button', class: 'btn', onclick: async () => {
              await flush();
              await mutate({ type: 'setActiveEnv', id: env.id });
              await refreshFromStorage();
              redraw();
              focusCurrent();
            } }, 'Set active'),
          iconButton('copy', 'Duplicate', async () => {
            await flush();
            const source = state.ws.environments[env.id];
            if (source) await add(copyName(source.name), source.vars);
          }),
          iconButton('trash', 'Delete', confirmDelete, { class: 'ibtn env-delete' }),
        );
      };

      function confirmDelete() {
        const cancel = el('button', { type: 'button', class: 'btn', onclick: () => {
          drawHead();
          head.querySelector('.env-delete').focus();
        } }, 'Cancel');
        head.replaceChildren(el('div', { class: 'env-confirm', role: 'alertdialog', 'aria-label': 'Delete environment' },
          el('span', {}, `Delete ${savedName}? Its variables will be removed.`),
          cancel,
          el('button', { type: 'button', class: 'btn danger', onclick: async () => {
            save.cancel();
            await saving;
            await mutate({ type: 'deleteEnvironment', id: env.id });
            await refreshFromStorage();
            chosen = state.ws.activeEnvId ?? liveEnvironments(state.ws)[0]?.id ?? null;
            redraw();
            focusCurrent();
          } }, 'Delete')));
        cancel.focus();
      }

      drawHead();
      editor.append(
        head,
        nameError,
        el('div', { class: 'env-row env-columns', 'aria-hidden': 'true' }, el('span', {}, 'Variable'), el('span', {}, 'Value'), el('span', { class: 'env-row-actions' })),
        rows,
        hint,
      );
    };

    box.append(
      el('div', { class: 'env-title' }, el('h2', {}, 'Environments'), iconButton('x', 'Close', close)),
      el('div', { class: 'env-body' }, list, editor),
      el('div', { class: 'env-foot' },
        el('span', { class: 'hint env-saved' }, icon('check'), 'Saved automatically'),
        el('button', { type: 'button', class: 'btn-primary', onclick: close }, 'Done')),
    );
    redraw();
  }, { className: 'dialog env-dialog' });

  // openDialog focuses the first control, which here is the close button.
  (initialFocus ?? document.querySelector('.env-list [aria-current="true"], .env-dialog .btn'))?.focus();
}
