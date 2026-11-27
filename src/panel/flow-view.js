// The flow shown in the main area: toolbar, canvas and the details column.

import { analyzeFlow } from '../lib/flow-graph.js';
import { runSummary } from '../lib/flow-record.js';
import { envVars } from '../lib/vars.js';
import { createCanvas } from './flow-canvas.js';
import { createDetails } from './flow-details.js';
import { createRunner, flowOrigins } from './flow-runner.js';
import { createScriptRunner, iframeFrame } from './script-runner.js';
import { ensureOrigins } from './permissions.js';
import { openSearch } from './search.js';
import { el, icon, iconButton, toast, showMenu } from './ui.js';

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
  const addRequestBlock = () => openSearch(getWs(), requestId => canvas.addRequest(requestId));
  // ＋ Block: a request from a collection, or a Logic block.
  const addBlock = e => {
    const r = e.currentTarget.getBoundingClientRect();
    showMenu(r.left, r.bottom + 4, [
      { label: 'Request…', icon: 'search', action: addRequestBlock },
      { label: 'Logic', icon: 'terminal', action: () => canvas.addLogic() },
    ]);
  };
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
    el('p', {}, 'Add a request from a collection, or a Logic block, with ＋ Block.'),
    el('button', { type: 'button', class: 'btn-primary', onclick: addBlock }, icon('plus'), 'Add first block'));
  const body = el('div', { class: 'flow-body' });
  const split = el('div', { class: 'flow-split' }, body);
  container.append(toolbar, split);

  let ws = getWs();
  let selectedId = null;
  let detailsOpen = true;
  let run = null; // the latest run record, from this page or another one
  const runner = createRunner({
    flowId, getWs, send, storage, onRecord: record => { run = record; draw(); },
    createLogicRunner: () => createScriptRunner({ createFrame: iframeFrame() }),
  });

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
      if (answer === 'pending') {
        toast('Allow access in the window that opened, then run again.', 4000);
        return;
      }
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
    onSelect: id => { selectedId = id; detailsOpen = true; draw(); },
    onChange: patch => mutate({ type: 'updateFlow', id: flowId, patch }),
    onBlockChange: (blockId, patch) => mutate({ type: 'updateBlock', id: flowId, blockId, patch }),
    onRunFrom: blockId => runOrStop(blockId),
    onOpenRequest,
    onLogicAdded: () => details.openTab?.('script'),
    store,
    viewKey: `flowView.${flowId}.${isWindow ? 'window' : 'panel'}`,
  });
  body.append(empty);

  const details = createDetails(split, {
    onGo: id => { selectedId = id; detailsOpen = true; draw(); canvas.center(id); },
    onBlockChange: (blockId, patch) => mutate({ type: 'updateBlock', id: flowId, blockId, patch }),
    onClose: closeDetails,
    onOpenRequest,
    store,
  });
  function closeDetails() {
    detailsOpen = false;
    draw();
    body.querySelector('.canvas')?.focus({ preventScroll: true });
  }
  body.addEventListener('keydown', e => {
    if (e.key === 'Escape' && detailsOpen && !details.element.hidden && !isEditable(e.target)) { e.preventDefault(); closeDetails(); }
  });

  function draw() {
    const flow = liveFlow(ws, flowId);
    if (!flow) return;
    name.textContent = flow.name;
    name.title = flow.name;
    empty.hidden = flow.blocks.length > 0;
    drawRunState(flow);
    const analysis = analyzeFlow(ws, flow, envVars(ws));
    canvas.render(ws, flow, run, analysis, selectedId);
    details.element.hidden = !detailsOpen || !flow.blocks.length;
    if (!details.element.hidden) details.render(ws, flow, run, analysis, selectedId);
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
      details.destroy();
      container.textContent = '';
    },
  };
}
