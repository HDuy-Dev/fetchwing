// Environments dialog: list on the left, variables of the chosen one on the right.

import { newId, liveEnvironments } from '../lib/model.js';
import { el, openDialog, debounce } from './ui.js';
import { mutate } from './panel.js';

export function openEnvironments(state) {
  let chosen = state.ws.activeEnvId ?? liveEnvironments(state.ws)[0]?.id ?? null;

  openDialog((box, close) => {
    const list = el('div', { style: 'display:flex;flex-direction:column;gap:2px;min-width:150px' });
    const editor = el('div', { style: 'flex:1;display:flex;flex-direction:column;gap:6px' });

    const drawList = () => {
      list.textContent = '';
      for (const env of liveEnvironments(state.ws)) {
        list.append(el('button', {
          type: 'button',
          class: env.id === chosen ? 'primary' : 'ghost',
          style: 'text-align:left',
          onclick: () => { chosen = env.id; drawList(); drawEditor(); },
        }, env.name + (env.id === state.ws.activeEnvId ? ' (active)' : '')));
      }
      list.append(el('button', {
        type: 'button', class: 'ghost',
        onclick: async () => {
          const id = newId();
          const res = await mutate({ type: 'addEnvironment', id, name: 'New environment' });
          if (res.ok) { chosen = id; await refreshFromStorage(); drawList(); drawEditor(); }
        },
      }, '+ Add environment'));
    };

    const drawEditor = () => {
      editor.textContent = '';
      const env = state.ws.environments[chosen];
      if (!env || env.deleted) {
        editor.append(el('div', { class: 'hint' }, 'Add an environment to define {{variables}}.'));
        return;
      }
      const vars = structuredClone(env.vars);
      const saveVars = debounce(() => mutate({ type: 'updateEnvironment', id: env.id, patch: { vars: vars.filter(v => v.key || v.value) } }), 300);
      const nameInput = el('input', { type: 'text', value: env.name, 'aria-label': 'Environment name' });
      nameInput.addEventListener('change', () => mutate({ type: 'updateEnvironment', id: env.id, patch: { name: nameInput.value } }).then(refreshFromStorage).then(drawList));

      const rows = el('div', { class: 'rows' });
      const drawRows = () => {
        rows.textContent = '';
        vars.forEach((v, i) => {
          const valueInput = el('input', { type: v.secret ? 'password' : 'text', value: v.value, placeholder: 'Value', 'aria-label': 'Value', oninput: e => { v.value = e.target.value; saveVars(); } });
          rows.append(el('div', { class: 'row' },
            el('input', { type: 'text', value: v.key, placeholder: 'Variable', 'aria-label': 'Variable name', oninput: e => { v.key = e.target.value; saveVars(); } }),
            valueInput,
            el('label', { class: 'hint', title: 'Secret values stay on this device and are never synced' },
              el('input', { type: 'checkbox', checked: v.secret, onchange: e => { v.secret = e.target.checked; valueInput.type = v.secret ? 'password' : 'text'; saveVars(); } }), 'Secret'),
            el('button', { type: 'button', class: 'ghost x', 'aria-label': 'Remove variable', onclick: () => { vars.splice(i, 1); saveVars(); drawRows(); } }, '✕')));
        });
        rows.append(el('div', {}, el('button', { type: 'button', class: 'ghost', onclick: () => { vars.push({ key: '', value: '', secret: false }); drawRows(); } }, '+ Add variable')));
      };
      drawRows();

      editor.append(
        el('label', { class: 'row' }, 'Name ', nameInput),
        el('div', { class: 'hint' }, 'Use variables as {{name}} in URLs, headers and bodies.'),
        rows,
        el('div', { class: 'row' },
          el('button', { type: 'button', onclick: () => mutate({ type: 'setActiveEnv', id: env.id }).then(refreshFromStorage).then(drawList) }, 'Use this environment'),
          el('span', { class: 'spacer', style: 'flex:1' }),
          el('button', { type: 'button', class: 'danger', onclick: async () => {
            await mutate({ type: 'deleteEnvironment', id: env.id });
            await refreshFromStorage();
            chosen = state.ws.activeEnvId ?? liveEnvironments(state.ws)[0]?.id ?? null;
            drawList();
            drawEditor();
          } }, 'Delete environment')),
      );
    };

    async function refreshFromStorage() {
      const { workspace } = await chrome.storage.local.get('workspace');
      if (workspace) state.ws = workspace;
    }

    box.append(
      el('h2', {}, 'Environments'),
      el('div', { style: 'display:flex;gap:12px;align-items:flex-start' }, list, editor),
      el('div', { class: 'actions' }, el('button', { type: 'button', class: 'primary', onclick: close }, 'Done')),
    );
    drawList();
    drawEditor();
  });
}
