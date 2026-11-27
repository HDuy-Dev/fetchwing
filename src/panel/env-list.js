// Environments in the sidebar: filter box, then one row each with its actions.

import { liveEnvironments } from '../lib/model.js';
import { filterEnvs } from '../lib/env-form.js';
import { el, icon, iconButton, showMenu } from './ui.js';

// One input for the panel's lifetime, so a redraw keeps the text and the caret.
const filter = el('input', { type: 'search', class: 'env-filter', placeholder: 'Filter', 'aria-label': 'Filter environments', spellcheck: 'false' });

// handlers: { onOpen(id), onSetActive(id), onDuplicate(id), onDelete(id) }
export function renderEnvList(container, ws, viewedId, handlers) {
  const list = el('div');

  const menuFor = (env, x, y) => showMenu(x, y, [
    { label: 'Duplicate', icon: 'copy', action: () => handlers.onDuplicate(env.id) },
    { label: 'Delete', icon: 'trash', danger: true, confirm: `Delete "${env.name}"?`, action: () => handlers.onDelete(env.id) },
  ]);

  // A button inside a row must not also open the environment.
  const inRow = (name, label, onClick, props = {}) => iconButton(name, label, e => { e.stopPropagation(); onClick(e); }, props);

  function rowFor(env) {
    const active = env.id === ws.activeEnvId;
    return el('div', {
      class: 'list-row env-item', role: 'button', tabindex: '0', title: env.name,
      'aria-current': env.id === viewedId ? 'true' : undefined,
      onclick: () => handlers.onOpen(env.id),
      onkeydown: e => { if (e.key === 'Enter' && e.target === e.currentTarget) handlers.onOpen(env.id); },
      oncontextmenu: e => { e.preventDefault(); menuFor(env, e.clientX, e.clientY); },
    },
    icon('braces'),
    el('span', { class: 'name' }, env.name),
    inRow('dots', 'More actions', e => {
      const r = e.currentTarget.getBoundingClientRect();
      menuFor(env, r.left, r.bottom + 2);
    }, { class: 'ibtn env-hover', 'aria-haspopup': 'menu' }),
    active
      ? el('span', { class: 'env-check env-slot', role: 'img', title: 'Active', 'aria-label': 'Active' }, icon('check'))
      : inRow('checkCircle', 'Set active', () => handlers.onSetActive(env.id), { class: 'ibtn env-hover env-slot' }));
  }

  function draw() {
    const all = liveEnvironments(ws);
    const shown = filterEnvs(all, filter.value);
    list.replaceChildren(...shown.map(rowFor));
    if (!shown.length) list.append(el('div', { class: 'side-empty' }, all.length ? 'No matches' : 'No environments yet.'));
  }

  filter.oninput = draw;
  draw();
  container.append(filter, list);
}
