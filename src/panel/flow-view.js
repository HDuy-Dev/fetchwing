// The flow shown in the main area: toolbar and canvas.

import { analyzeFlow } from '../lib/flow-graph.js';
import { runSummary } from '../lib/flow-record.js';
import { envVars } from '../lib/vars.js';
import { createCanvas } from './flow-canvas.js';
import { createRunner, flowOrigins } from './flow-runner.js';
import { ensureOrigins } from './permissions.js';
import { openSearch } from './search.js';
import { el, icon, iconButton, toast } from './ui.js';

const liveFlow = (ws, id) => {
  const flow = ws?.flows?.[id];
  return flow && !flow.deleted ? flow : null;
};

const isEditable = t => t instanceof Element && t.closest('input, textarea, select, [contenteditable="true"]');

// options: { flowId, getWs, mutate, send, store, isWindow, getTabId?, onOpenRequest?(requestId), storage? }
export function mountFlowView(container, { flowId, getWs, mutate, send, store, isWindow, getTabId, onOpenRequest, storage = chrome.storage.session }) {
  container.textContent = '';
  const name = el('h2', { class: 'flow-name' });
  const openWindow = async () => {
    // The DevTools panel may not have chrome.windows, so the worker opens it.
    const res = await send({ type: 'openEditorWindow', flowId, tabId: getTabId?.() ?? null });
    if (!res?.ok) toast(res?.error ?? 'Could not open the window.');
  };
  const addBlock = () => openSearch(getWs(), requestId => canvas.addRequest(requestId));
  const runBtn = el('button', { type: 'button', class: 'btn-primary flow-run', disabled: true, onclick: () => runOrStop() });
  const summary = el('span', { class: 'flow-summary', 'aria-live': 'polite' });
  const toolbar = el('div', { class: 'flow-toolbar' },
    icon('flow', 'flow-icon'), name, summary,
    el('div', { class: 'flow-actions' },
      runBtn,
      el('button', { type: 'button', class: 'btn', onclick: addBlock }, icon('plus'), 'Block'),
      isWindow ? null : iconButton('popout', 'Open in window', openWindow)));
  const empty = el('div', { class: 'flow-empty', hidden: true },
    icon('flow', 'big'),
    el('p', { class: 'flow-empty-title' }, 'This flow is empty'),
    el('p', {}, 'Add a request from a collection with ＋ Block.'),
    el('button', { type: 'button', class: 'btn-primary', onclick: addBlock }, icon('plus'), 'Add first block'));
  const body = el('div', { class: 'flow-body' });
  container.append(toolbar, body);

  let ws = getWs();
  let selectedId = null;
  let run = null; // the latest run record, from this page or another one
  const runner = createRunner({ flowId, getWs, send, storage, onRecord: record => { run = record; draw(); } });

  // Must run inside the click: Chrome only shows the permission prompt during a user gesture.
  function runOrStop(from = null) {
    if (runner.isLive()) {
      if (from) toast('The flow is already running.');
      else runner.stop();
      return;
    }
    const current = getWs();
    const flow = liveFlow(current, flowId);
    if (!flow?.blocks.length) return;
    const origins = flowOrigins(current, flow, { from });
    ensureOrigins(origins).then(answer => {
      if (answer !== 'granted') {
        const hosts = origins.map(o => new URL(o).host).join(', ');
        toast(`Fetchwing needs access to ${hosts} to run this flow`, 4000);
        return;
      }
      return runner.run({ from });
    }).catch(err => toast(`Could not run the flow: ${err?.message ?? err}`));
  }

  const onKey = e => {
    if (!(e.metaKey || e.ctrlKey) || e.key !== 'Enter' || e.defaultPrevented) return;
    if (!container.isConnected || container.closest('[hidden]') || isEditable(e.target) || e.target.closest?.('.dialog-backdrop')) return;
    e.preventDefault();
    runOrStop();
  };
  document.addEventListener('keydown', onKey);

  // The canvas is made once per mounted flow so pan, zoom, selection and drags survive updates.
  const canvas = createCanvas(body, {
    onSelect: id => { selectedId = id; draw(); },
    onChange: patch => mutate({ type: 'updateFlow', id: flowId, patch }),
    onRunFrom: blockId => runOrStop(blockId),
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
    drawRunState(flow);
    canvas.render(ws, flow, run, analyzeFlow(ws, flow, envVars(ws)), selectedId);
  }

  function drawRunState(flow) {
    const live = runner.isLive();
    runBtn.disabled = !live && !flow.blocks.length;
    runBtn.classList.toggle('stop', live);
    runBtn.title = live ? 'Stop (⌘↵)' : 'Run (⌘↵)';
    runBtn.replaceChildren(icon(live ? 'stop' : 'play'), live ? 'Stop' : 'Run');
    const groups = runSummary(run);
    summary.title = groups.map(g => g.map(p => p.text).join(' ')).join(' · ');
    summary.replaceChildren(...groups.flatMap((group, i) => [
      i ? el('span', { class: 'sep', 'aria-hidden': 'true' }, '·') : null,
      ...group.map(p => el('span', { class: p.cls || undefined }, p.text)),
    ]).filter(Boolean));
  }

  function update(next) {
    ws = next;
    draw();
  }

  draw();
  return {
    update,
    destroy() {
      document.removeEventListener('keydown', onKey);
      runner.dispose();
      canvas.destroy();
      container.textContent = '';
    },
  };
}
