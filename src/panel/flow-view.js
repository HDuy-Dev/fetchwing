// The flow shown in the main area: toolbar and canvas (the canvas comes later).

import { el, icon, iconButton, toast } from './ui.js';

const liveFlow = (ws, id) => {
  const flow = ws?.flows?.[id];
  return flow && !flow.deleted ? flow : null;
};

// options: { flowId, getWs, mutate, send, store, isWindow, getTabId?, onAddBlock? }
export function mountFlowView(container, { flowId, getWs, send, isWindow, getTabId, onAddBlock }) {
  container.textContent = '';
  const name = el('h2', { class: 'flow-name' });
  const addBlock = () => onAddBlock?.(flowId);
  const openWindow = async () => {
    // The DevTools panel may not have chrome.windows, so the worker opens it.
    const res = await send({ type: 'openEditorWindow', flowId, tabId: getTabId?.() ?? null });
    if (!res?.ok) toast(res?.error ?? 'Could not open the window.');
  };
  const toolbar = el('div', { class: 'flow-toolbar' },
    icon('flow', 'flow-icon'), name,
    el('div', { class: 'flow-actions' },
      el('button', { type: 'button', class: 'btn-primary flow-run', disabled: true, title: 'Run (⌘↵)' }, icon('play'), 'Run'),
      el('button', { type: 'button', class: 'btn', disabled: !onAddBlock, onclick: addBlock }, icon('plus'), 'Block'),
      isWindow ? null : iconButton('popout', 'Open in window', openWindow)));
  const body = el('div', { class: 'flow-body' });
  container.append(toolbar, body);

  function update(ws) {
    const flow = liveFlow(ws, flowId);
    if (!flow) return;
    name.textContent = flow.name;
    name.title = flow.name;
    body.textContent = '';
    if (!flow.blocks.length) {
      body.append(el('div', { class: 'flow-empty' },
        icon('flow', 'big'),
        el('p', { class: 'flow-empty-title' }, 'This flow is empty'),
        el('p', {}, 'Add a request from a collection, or drag one from the tree on the left.'),
        el('button', { type: 'button', class: 'btn-primary', disabled: !onAddBlock, onclick: addBlock }, icon('plus'), 'Add first block')));
    }
  }

  update(getWs());
  return {
    update,
    destroy() { container.textContent = ''; },
  };
}
