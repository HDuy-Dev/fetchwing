// Open-request tabs above the editor.

import { el, icon } from './ui.js';

// handlers: { onActivate(id), onClose(id), onNew(), isPending(id) }
export function renderTabs(container, ws, openIds, activeId, handlers) {
  container.textContent = '';
  for (const id of openIds) {
    const item = ws.items[id];
    if (!item || item.deleted) continue;
    const active = id === activeId;
    const tab = el('div', {
      class: 'otab', role: 'tab', tabindex: active ? '0' : '-1', 'aria-selected': String(active), title: item.name,
      onclick: () => handlers.onActivate(id),
      onauxclick: e => { if (e.button === 1) { e.preventDefault(); handlers.onClose(id); } },
      onkeydown: e => { if (e.key === 'Enter') handlers.onActivate(id); },
    },
    el('span', { class: `m ${item.method}` }, item.method),
    el('span', { class: 'name' }, item.name),
    item.mock.enabled ? el('span', { class: 'mdot', title: 'Mock on', 'aria-label': 'Mock on' }) : null,
    handlers.isPending(id) ? el('span', { class: 'unsaved', title: 'Saving…', 'aria-label': 'Saving' }) : null,
    el('button', {
      type: 'button', class: 'x', 'aria-label': `Close ${item.name}`, title: 'Close',
      onclick: e => { e.stopPropagation(); handlers.onClose(id); },
    }, icon('x')));
    container.append(tab);
    if (active) requestAnimationFrame(() => tab.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  }
  container.append(el('button', { type: 'button', class: 'add-tab', 'aria-label': 'New request', title: 'New request', onclick: handlers.onNew }, icon('plus')));
}
