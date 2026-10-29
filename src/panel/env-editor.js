// Environments dialog: list on the left, variables of the chosen one on the right.

import { newId, liveEnvironments } from '../lib/model.js';
import { el, icon, openDialog, debounce } from './ui.js';
import { mutate } from './panel.js';

// opts: { envId?, addVar? } — open on one environment, optionally with a new variable row.
export function openEnvironments(state, { envId, addVar } = {}) {
  let chosen = envId ?? state.ws.activeEnvId ?? liveEnvironments(state.ws)[0]?.id ?? null;
  let pendingVar = addVar ?? null;

  openDialog((box, close) => {
    const list = el('div', { style: 'display:flex;flex-direction:column;gap:2px;min-width:150px' });
    const editor = el('div', { style: 'flex:1;display:flex;flex-direction:column;gap:6px' });

    const drawList = () => {
      list.textContent = '';
      for (const env of liveEnvironments(state.ws)) {
        list.append(el('button', {
          type: 'button',
          class: 'list-row',
          'aria-current': env.id === chosen ? 'true' : undefined,
          style: env.id === chosen ? 'background:var(--select)' : undefined,
          onclick: () => { chosen = env.id; drawList(); drawEditor(); },
        }, el('span', { class: 'name' }, env.name), env.id === state.ws.activeEnvId ? el('span', { class: 'mdot', style: 'background:var(--accent)', title: 'Active', 'aria-label': 'Active' }) : null));
      }
      list.append(el('button', {
        type: 'button', class: 'list-row', 'aria-label': 'Add environment', title: 'Add environment',
        onclick: async () => {
          const id = newId();
          const res = await mutate({ type: 'addEnvironment', id, name: 'New environment' });
          if (res.ok) { chosen = id; await refreshFromStorage(); drawList(); drawEditor(); }
        },
      }, icon('plus'), el('span', { class: 'name hint' }, 'New')));
    };

    const drawEditor = () => {
      editor.textContent = '';
      const env = state.ws.environments[chosen];
      if (!env || env.deleted) {
        editor.append(el('div', { class: 'hint' }, 'Add an environment to define {{variables}}.'));
        return;
      }
      const vars = structuredClone(env.vars);
      if (pendingVar) { vars.push({ key: pendingVar, value: '', secret: false }); pendingVar = null; }
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
            el('label', { class: 'hint', style: 'display:flex;align-items:center', title: 'Secret: stays on this device, never synced' },
              el('input', { type: 'checkbox', class: 'cbx', checked: v.secret, onchange: e => { v.secret = e.target.checked; valueInput.type = v.secret ? 'password' : 'text'; saveVars(); } }), 'Secret'),
            el('button', { type: 'button', class: 'ibtn', 'aria-label': 'Remove variable', title: 'Remove', onclick: () => { vars.splice(i, 1); saveVars(); drawRows(); } }, icon('x'))));
        });
        rows.append(el('div', {}, el('button', { type: 'button', class: 'ibtn', 'aria-label': 'Add variable', title: 'Add variable', onclick: () => { vars.push({ key: '', value: '', secret: false }); drawRows(); rows.querySelectorAll('input[type=text]')[vars.length * 2 - 2]?.focus(); } }, icon('plus'))));
      };
      drawRows();

      editor.append(
        el('div', { class: 'row' }, nameInput),
        el('div', { class: 'hint' }, 'Use as {{name}}'),
        rows,
        el('div', { class: 'row' },
          env.id === state.ws.activeEnvId ? el('span', { class: 'hint' }, 'Active') : el('button', { type: 'button', class: 'btn', onclick: () => mutate({ type: 'setActiveEnv', id: env.id }).then(refreshFromStorage).then(drawList).then(drawEditor) }, 'Use'),
          el('span', { class: 'spacer', style: 'flex:1' }),
          el('button', { type: 'button', class: 'ibtn', style: 'color:var(--err)', 'aria-label': 'Delete environment', title: 'Delete environment', onclick: async () => {
            await mutate({ type: 'deleteEnvironment', id: env.id });
            await refreshFromStorage();
            chosen = state.ws.activeEnvId ?? liveEnvironments(state.ws)[0]?.id ?? null;
            drawList();
            drawEditor();
          } }, icon('trash'))),
      );
    };

    async function refreshFromStorage() {
      const { workspace } = await chrome.storage.local.get('workspace');
      if (workspace) state.ws = workspace;
    }

    box.append(
      el('h2', {}, 'Environments'),
      el('div', { style: 'display:flex;gap:12px;align-items:flex-start' }, list, editor),
      el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn-primary', onclick: close }, 'Done')),
    );
    drawList();
    drawEditor();
  });
}
