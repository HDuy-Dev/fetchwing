// Collections tree: select, expand, inline rename, context menu, drag to move.

import { children } from '../lib/model.js';
import { el, icon, showMenu } from './ui.js';

// handlers: { onSelect(id), onOpen(id), onRename(id, name), onMove(id, parentId, order),
//             onNew(type, parentId), onDelete(id), isExpanded(id), toggle(id) }
export function renderTree(container, ws, selectedId, handlers) {
  container.textContent = '';
  container.setAttribute('role', 'tree');
  let dragId = null;

  const addNodes = (parentId, depth) => {
    for (const item of children(ws, parentId)) {
      container.append(nodeFor(item, depth));
      if (item.type !== 'request' && handlers.isExpanded(item.id)) addNodes(item.id, depth + 1);
    }
  };

  function startRename(row, item) {
    const nameEl = row.querySelector('.name');
    const input = el('input', { type: 'text', value: item.name, 'aria-label': 'Name' });
    let done = false;
    const finish = save => {
      if (done) return;
      done = true;
      const name = input.value.trim();
      if (save && name && name !== item.name) handlers.onRename(item.id, name);
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

  function menuFor(row, item, x, y) {
    const items = [];
    if (item.type !== 'request') {
      items.push({ label: 'New request', icon: 'plus', action: () => handlers.onNew('request', item.id) });
      items.push({ label: 'New folder', icon: 'folder', action: () => handlers.onNew('folder', item.id) });
      items.push('sep');
    }
    items.push({ label: 'Rename', icon: 'edit', action: () => startRename(row, item) });
    items.push({
      label: 'Delete', icon: 'trash', danger: true, action: () => handlers.onDelete(item.id),
      confirm: item.type === 'request' ? `Delete "${item.name}"?` : `Delete "${item.name}" and everything in it?`,
    });
    showMenu(x, y, items);
  }

  function nodeFor(item, depth) {
    const isContainer = item.type !== 'request';
    const expanded = isContainer && handlers.isExpanded(item.id);
    const row = el('div', {
      class: `node ${item.type}`,
      role: 'treeitem',
      tabindex: item.id === selectedId ? '0' : '-1',
      'aria-selected': String(item.id === selectedId),
      'aria-expanded': isContainer ? String(expanded) : undefined,
      draggable: 'true',
      dataset: { id: item.id },
      style: `--d:${depth}`,
    },
    isContainer ? el('span', { class: 'caret', 'aria-hidden': 'true' }, expanded ? '▾' : '▸') : null,
    item.type === 'folder' ? icon('folder', 'folder-icon') : null,
    item.type === 'request' ? el('span', { class: `m ${item.method}` }, item.method) : null,
    el('span', { class: 'name', title: item.name }, item.name),
    item.type === 'request' && item.mock.enabled ? el('span', { class: 'mdot', title: 'Mock on', 'aria-label': 'Mock on' }) : null);

    row.addEventListener('click', e => {
      // Second click of a double-click: rename here (a re-render would detach this row).
      if (e.detail === 2) { startRename(row, item); return; }
      if (e.detail > 2) return;
      if (isContainer) handlers.toggle(item.id);
      handlers.onSelect(item.id);
    });
    row.addEventListener('keydown', e => {
      if (e.key === 'F2') startRename(row, item);
      if (e.key === 'Enter') isContainer ? handlers.toggle(item.id) : handlers.onSelect(item.id);
    });
    row.addEventListener('contextmenu', e => {
      e.preventDefault();
      menuFor(row, item, e.clientX, e.clientY);
    });

    // Drop on a collection/folder = move inside (last); on a request = before it.
    row.addEventListener('dragstart', e => { dragId = item.id; e.dataTransfer.effectAllowed = 'move'; });
    row.addEventListener('dragover', e => {
      if (!dragId || dragId === item.id) return;
      e.preventDefault();
      row.classList.add(isContainer ? 'drop-into' : 'drop-before');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-into', 'drop-before'));
    row.addEventListener('drop', e => {
      e.preventDefault();
      row.classList.remove('drop-into', 'drop-before');
      const moving = ws.items[dragId];
      if (!moving) return;
      if (moving.type === 'collection') {
        if (item.type === 'collection') handlers.onMove(dragId, null, item.order);
      } else if (isContainer) {
        handlers.onMove(dragId, item.id, children(ws, item.id).length);
      } else {
        handlers.onMove(dragId, item.parentId, item.order);
      }
      dragId = null;
    });
    return row;
  }

  addNodes(null, 0);
  if (!container.children.length) container.append(el('div', { class: 'side-empty' }, 'No collections yet.'));
}
