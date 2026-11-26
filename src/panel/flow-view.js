// The flow shown in the main area: toolbar and canvas.

import { analyzeFlow } from '../lib/flow-graph.js';
import { envVars } from '../lib/vars.js';
import { createCanvas } from './flow-canvas.js';
import { openSearch } from './search.js';
import { el, icon, iconButton, toast } from './ui.js';

const liveFlow = (ws, id) => {
  const flow = ws?.flows?.[id];
  return flow && !flow.deleted ? flow : null;
};

// options: { flowId, getWs, mutate, send, store, isWindow, getTabId?, onOpenRequest?(requestId) }
export function mountFlowView(container, { flowId, getWs, mutate, send, store, isWindow, getTabId, onOpenRequest }) {
  container.textContent = '';
  const name = el('h2', { class: 'flow-name' });
  const openWindow = async () => {
    // The DevTools panel may not have chrome.windows, so the worker opens it.
    const res = await send({ type: 'openEditorWindow', flowId, tabId: getTabId?.() ?? null });
    if (!res?.ok) toast(res?.error ?? 'Could not open the window.');
  };
  const addBlock = () => openSearch(getWs(), requestId => canvas.addRequest(requestId));
  const toolbar = el('div', { class: 'flow-toolbar' },
    icon('flow', 'flow-icon'), name,
    el('div', { class: 'flow-actions' },
      el('button', { type: 'button', class: 'btn-primary flow-run', disabled: true, title: 'Run (⌘↵)' }, icon('play'), 'Run'),
      el('button', { type: 'button', class: 'btn', onclick: addBlock }, icon('plus'), 'Block'),
      isWindow ? null : iconButton('popout', 'Open in window', openWindow)));
  const empty = el('div', { class: 'flow-empty', hidden: true },
    icon('flow', 'big'),
    el('p', { class: 'flow-empty-title' }, 'This flow is empty'),
    el('p', {}, 'Add a request from a collection, or drag one from the tree on the left.'),
    el('button', { type: 'button', class: 'btn-primary', onclick: addBlock }, icon('plus'), 'Add first block'));
  const body = el('div', { class: 'flow-body' });
  container.append(toolbar, body);

  let ws = getWs();
  let selectedId = null;
  const run = null; // the run record arrives with running flows
  // The canvas is made once per mounted flow so pan, zoom, selection and drags survive updates.
  const canvas = createCanvas(body, {
    onSelect: id => { selectedId = id; draw(); },
    onChange: patch => mutate({ type: 'updateFlow', id: flowId, patch }),
    onOpenRequest,
    store,
    viewKey: `flowView.${flowId}.${isWindow ? 'window' : 'panel'}`,
  });
  body.append(empty);

  function draw() {
    const flow = liveFlow(ws, flowId);
    if (!flow) return;
    name.textContent = flow.name;
    name.title = flow.name;
    empty.hidden = flow.blocks.length > 0;
    canvas.render(ws, flow, run, analyzeFlow(ws, flow, envVars(ws)), selectedId);
  }

  function update(next) {
    ws = next;
    draw();
  }

  draw();
  return {
    update,
    destroy() { canvas.destroy(); container.textContent = ''; },
  };
}
