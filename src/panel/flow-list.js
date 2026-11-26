// Flows sidebar list: open, inline rename, context menu with delete.

import { liveFlows } from '../lib/model.js';
import { el, icon, showMenu } from './ui.js';

// handlers: { onOpen(id), onAdd(), onRename(id, name), onDelete(id) }
export function renderFlowList(container, ws, selectedFlowId, handlers) {
  container.textContent = '';
  const flows = liveFlows(ws);
  if (!flows.length) {
    container.append(el('div', { class: 'side-empty flow-list-empty' },
      el('p', {}, 'No flows yet'),
      el('button', { type: 'button', class: 'btn', onclick: () => handlers.onAdd() }, icon('plus'), 'New flow')));
    return;
  }

  // Same inline rename as the collections tree.
  function startRename(row, flow) {
    const nameEl = row.querySelector('.name');
    const input = el('input', { type: 'text', value: flow.name, 'aria-label': 'Name' });
    let done = false;
    const finish = save => {
      if (done) return;
      done = true;
      const name = input.value.trim();
      if (save && name && name !== flow.name) handlers.onRename(flow.id, name);
      else { nameEl.hidden = false; input.remove(); }
    };
    input.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('click', e => e.stopPropagation());
    nameEl.hidden = true;
    nameEl.after(input);
    input.focus();
    input.select();
  }

  for (const flow of flows) {
    const row = el('div', {
      class: 'list-row flow-row', role: 'button', tabindex: '0',
      'aria-current': flow.id === selectedFlowId ? 'true' : undefined,
      dataset: { id: flow.id },
    }, icon('flow', 'flow-icon'), el('span', { class: 'name', title: flow.name }, flow.name));
    row.addEventListener('click', e => {
      // Second click of a double-click: rename here (a re-render would detach this row).
      if (e.detail === 2) { startRename(row, flow); return; }
      if (e.detail > 2) return;
      handlers.onOpen(flow.id);
    });
    row.addEventListener('keydown', e => {
      if (e.target !== row) return;
      if (e.key === 'F2') startRename(row, flow);
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handlers.onOpen(flow.id); }
    });
    row.addEventListener('contextmenu', e => {
      e.preventDefault();
      showMenu(e.clientX, e.clientY, [
        { label: 'Rename', icon: 'edit', action: () => startRename(row, flow) },
        { label: 'Delete', icon: 'trash', danger: true, confirm: `Delete "${flow.name}"?`, action: () => handlers.onDelete(flow.id) },
      ]);
    });
    container.append(row);
  }
}
