// The flow canvas: blocks and edges on a pannable, zoomable world, with editing.

import { FAR_ZOOM, GRID, zoomAt, fitView, snap, midEllipsis, edgeLabel } from '../lib/flow-view.js';
import { edgeVars, fingerprintOf, isLogic, upstream } from '../lib/flow-graph.js';
import { newLogicBlock } from '../lib/logic-block.js';
import { blockStatus, runFromHere, envChanged } from '../lib/flow-record.js';
import { envVars } from '../lib/vars.js';
import { newId } from '../lib/model.js';
import { el, toast, showMenu } from './ui.js';

const SVG = 'http://www.w3.org/2000/svg';
const W = 200; // block width
const PORT_Y = 33; // ports sit this far below the block's top
const DRAG_TYPE = 'application/x-fetchwing-request';
const ICON = { idle: '', queued: '', running: '', ok: '✓', bad: '✕', skip: '⊘', warn: '!' };
const CLASS = { ok: 'ok', failed: 'bad', skipped: 'skip', missing: 'warn', running: 'running', queued: 'queued' };
const TEXT = { idle: 'Not run', queued: 'Queued', running: 'Running…', skipped: 'Skipped', missing: 'Missing variable' };

const svgEl = (tag, attrs = {}) => {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};
const sameEdge = (a, b) => a && b && a.from === b.from && a.to === b.to;
const isEditable = t => t instanceof Element && t.closest('input, textarea, select, [contenteditable="true"]');

// What the status line says: the run's state when there is one, otherwise the analysis.
function statusOf(entry, result) {
  if (result && result.state !== 'idle') {
    const cls = CLASS[result.state] ?? 'idle';
    const ms = result.endMs != null && result.startMs != null ? `${Math.round(result.endMs - result.startMs)} ms` : '';
    let text = TEXT[result.state] ?? result.state;
    if (result.logic && (result.state === 'ok' || result.state === 'failed')) {
      text = result.state === 'ok' ? ms || 'Done' : result.error || 'Failed';
    } else if (result.state === 'ok' || result.state === 'failed') {
      text = result.response ? [result.response.status, ms].filter(Boolean).join(' · ') : result.error || 'Failed';
    }
    return { cls, text, fromRun: true };
  }
  if (entry?.deleted) return { cls: 'bad', text: 'Request deleted' };
  if (entry?.conflicts.length) return { cls: 'warn', text: `Conflict ${entry.conflicts.join(', ')}` };
  if (entry?.missing.length) return { cls: 'warn', text: `Missing ${entry.missing.join(', ')}` };
  return { cls: 'idle', text: TEXT.idle };
}

// options: { onSelect(blockId|null), onChange(patch) -> Promise<{ok}>, onRunFrom(blockId), onOpenRequest(requestId),
//            onLogicAdded?(blockId), store?, viewKey? (where the pan/zoom is kept) }
export function createCanvas(container, { onSelect, onChange, onRunFrom, onOpenRequest, onLogicAdded, store, viewKey }) {
  const grid = el('div', { class: 'grid', 'aria-hidden': 'true' });
  const edgesSvg = svgEl('svg', { class: 'edges' });
  const labels = el('div', { class: 'labels' });
  const world = el('div', { class: 'world' }, edgesSvg, labels);
  const pct = el('button', { type: 'button', class: 'pct', title: 'Reset to 100% (⌘0)' }, '100%');
  const zoomBtn = (text, title, fn) => el('button', { type: 'button', title, 'aria-label': title, onclick: fn }, text);
  const zoomBar = el('div', { class: 'zoom' },
    zoomBtn('−', 'Zoom out (⌘−)', () => zoomBy(1 / 1.25)), pct,
    zoomBtn('+', 'Zoom in (⌘+)', () => zoomBy(1.25)), zoomBtn('⤢', 'Fit (⇧1)', () => fit()));
  pct.addEventListener('click', () => zoomTo(1));
  const root = el('div', { class: 'canvas', tabindex: '0', 'aria-label': 'Flow canvas' }, grid, world, zoomBar);
  container.append(root);

  let ws = null, flow = null, run = null, analysis = new Map(), selectedId = null;
  let selectedEdge = null;
  const nodes = new Map(); // blockId -> element
  const pending = new Map(); // blockId -> { x, y } saved but not yet back from storage
  let drag = null; // { id, x, y } while a block is being moved
  let spaceDown = false, hover = false;

  const saved = store && viewKey ? store.get(viewKey, null) : null;
  let view = saved && Number.isFinite(saved.k) ? saved : { x: 40, y: 40, k: 1 };
  let placed = Boolean(saved);
  let saveTimer = null;
  const saveView = () => {
    if (!store || !viewKey) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => store.set(viewKey, view), 250);
  };

  // ---------- view ----------
  function applyView() {
    world.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.k})`;
    world.classList.toggle('far', view.k < FAR_ZOOM);
    pct.textContent = `${Math.round(view.k * 100)}%`;
    const g = GRID * view.k, r = Math.max(0.6, view.k);
    const ox = ((view.x % g) + g) % g, oy = ((view.y % g) + g) % g;
    grid.style.background = `radial-gradient(circle at ${ox}px ${oy}px, var(--divider) ${r}px, transparent ${r + 0.4}px) 0 0 / ${g}px ${g}px`;
  }
  const setView = (next, persist = true) => { view = next; placed = true; applyView(); if (persist) saveView(); };
  const centerPoint = () => [root.clientWidth / 2, root.clientHeight / 2];
  const zoomBy = f => setView(zoomAt(view, view.k * f, ...centerPoint()));
  const zoomTo = k => setView(zoomAt(view, k, ...centerPoint()));
  const toWorld = (clientX, clientY) => {
    const r = root.getBoundingClientRect();
    return { x: (clientX - r.left - view.x) / view.k, y: (clientY - r.top - view.y) / view.k };
  };
  const posOf = b => (drag?.id === b.id ? drag : pending.get(b.id)) ?? b;

  function fit() {
    if (!flow || !root.clientWidth) return;
    const rects = flow.blocks.map(b => ({ ...posOf(b), w: W, h: nodes.get(b.id)?.offsetHeight || 80 }));
    setView(fitView(rects, root.clientWidth, root.clientHeight));
  }

  function center(blockId) {
    const b = flow?.blocks.find(x => x.id === blockId);
    if (!b) return;
    const p = posOf(b), k = Math.max(view.k, 0.8);
    world.style.transition = 'transform .25s ease';
    setView({ k, x: root.clientWidth / 2 - (p.x + W / 2) * k, y: root.clientHeight / 2 - (p.y + PORT_Y) * k });
    setTimeout(() => { world.style.transition = ''; }, 260);
  }

  // ---------- drawing ----------
  // The block's current fingerprint, or null when it can't run (its request is gone).
  const currentFingerprint = b => fingerprintOf(ws, b, envVars(ws));

  function paintNode(node, b) {
    const logic = isLogic(b);
    const entry = analysis.get(b.id);
    const request = entry?.request;
    const gone = ws?.items?.[b.requestId];
    const name = logic ? b.name || 'Logic' : request?.name ?? gone?.name ?? 'Deleted request';
    const method = logic ? 'JS' : request?.method ?? '';
    const result = run?.blocks?.[b.id];
    const st = statusOf(entry, result);
    const fp = (logic || request) && result && (result.state === 'ok' || result.state === 'failed') ? currentFingerprint(b) : null;
    const outdated = fp !== null && blockStatus(run, b.id, fp).outdated;
    const flags = [];
    if (st.fromRun) {
      if (entry?.deleted) flags.push(['bad', 'Request deleted']);
      for (const n of entry?.missing ?? []) flags.push(['warn', `! Missing ${n}`]);
      for (const n of entry?.conflicts ?? []) flags.push(['warn', `! Conflict ${n}`]);
    }
    const mocked = !logic && (result?.state === 'ok' || result?.state === 'failed' ? Boolean(result.mock) : Boolean(request?.mock?.enabled));
    const outNames = (b.outputs || []).map(o => o.name);
    const middle = logic
      ? el('div', { class: 'u', title: outNames.join(', ') }, outNames.length ? midEllipsis(`→ ${outNames.join(', ')}`, 30) : 'No outputs')
      : request ? el('div', { class: 'u', title: request.url }, midEllipsis(request.url, 30)) : null;
    const changedWhat = logic ? 'The script changed after this run' : 'The request changed after this run';
    node.className = `node n-${st.cls}${logic ? ' logic' : ''}${b.id === selectedId ? ' sel' : ''}${mocked ? ' mocked' : ''}${drag?.id === b.id ? ' dragging' : ''}`;
    node.setAttribute('aria-label', `${method} ${name}: ${st.text}`.trim());
    node.replaceChildren(...[
      el('span', { class: 'port in', 'aria-hidden': 'true' }),
      el('span', { class: 'port out', title: 'Drag to connect to another block', 'aria-hidden': 'true' }),
      el('div', { class: 't' },
        method ? el('span', { class: `m ${method}` }, method) : null,
        el('span', { class: 'nm', title: name }, name),
        mocked ? el('span', { class: 'badge', title: 'Answered by the mock' }, 'MOCK') : null),
      middle,
      el('div', { class: `st s-${st.cls}` },
        el('span', { class: 'ico', 'aria-hidden': 'true' }, ICON[st.cls]),
        el('span', { class: 'txt', title: st.text }, st.text),
        outdated ? el('span', { class: 'stale', title: changedWhat }, 'outdated') : null),
      flags.length ? el('div', { class: 'flags' }, flags.map(([c, t]) => el('span', { class: `flag ${c}` }, t))) : null,
    ].filter(Boolean));
  }

  function layout() {
    if (!flow) return;
    const pos = new Map(flow.blocks.map(b => [b.id, posOf(b)]));
    for (const b of flow.blocks) {
      const node = nodes.get(b.id), p = pos.get(b.id);
      node.style.left = `${p.x}px`;
      node.style.top = `${p.y}px`;
    }
    // The svg covers every block so its edges can be clicked.
    const xs = [...pos.values()].map(p => p.x), ys = [...pos.values()].map(p => p.y);
    const x0 = Math.min(0, ...xs) - 400, y0 = Math.min(0, ...ys) - 400;
    const w = Math.max(0, ...xs) + W + 400 - x0, h = Math.max(0, ...ys) + 400 - y0;
    Object.assign(edgesSvg.style, { left: `${x0}px`, top: `${y0}px` });
    edgesSvg.setAttribute('width', w);
    edgesSvg.setAttribute('height', h);
    edgesSvg.setAttribute('viewBox', `${x0} ${y0} ${w} ${h}`);
    edgesSvg.replaceChildren();
    labels.replaceChildren();
    for (const e of flow.edges) {
      const a = pos.get(e.from), b = pos.get(e.to);
      if (!a || !b) continue;
      const x1 = a.x + W, y1 = a.y + PORT_Y, x2 = b.x, y2 = b.y + PORT_Y, c = Math.max(50, (x2 - x1) / 2);
      const d = `M${x1} ${y1} C ${x1 + c} ${y1}, ${x2 - c} ${y2}, ${x2} ${y2}`;
      const sa = run?.blocks?.[e.from]?.state, sb = run?.blocks?.[e.to]?.state;
      const state = sa === 'failed' || sa === 'skipped' || sa === 'missing' ? 'blocked'
        : sa === 'ok' && sb === 'running' ? 'flowing' : sa === 'ok' ? 'passed' : '';
      const sel = sameEdge(e, selectedEdge) ? ' sel' : '';
      const hit = svgEl('path', { d, class: 'hit' });
      const pick = ev => { ev.stopPropagation(); if (ev.button === 0) selectEdge(e); };
      hit.addEventListener('pointerdown', pick);
      edgesSvg.append(svgEl('path', { d, class: `${state}${sel}`.trim() }), hit);
      const vars = edgeVars(ws, flow, e);
      if (vars.length) {
        const { text, title } = edgeLabel(vars);
        const label = el('span', { class: `vlabel${sa === 'ok' ? ' passed' : ''}${sel}`, title }, text);
        label.style.left = `${(x1 + x2) / 2}px`;
        label.style.top = `${(y1 + y2) / 2}px`;
        label.addEventListener('pointerdown', pick);
        labels.append(label);
      }
    }
  }

  function paint() {
    if (!flow) return;
    const live = new Set(flow.blocks.map(b => b.id));
    for (const [id, node] of nodes) if (!live.has(id)) { node.remove(); nodes.delete(id); }
    if (selectedEdge && !flow.edges.some(e => sameEdge(e, selectedEdge))) selectedEdge = null;
    // Tab order follows the layout: left to right, then top to bottom.
    const ordered = [...flow.blocks].sort((a, b) => posOf(a).x - posOf(b).x || posOf(a).y - posOf(b).y);
    const current = [...world.querySelectorAll(':scope > .node')].map(n => n.dataset.id);
    const reorder = current.length !== ordered.length || ordered.some((b, i) => b.id !== current[i]);
    for (const b of ordered) {
      const node = nodes.get(b.id) ?? makeNode(b.id);
      paintNode(node, b);
      // Moving a node in the DOM drops its focus, so only reorder when needed.
      if (reorder || !node.isConnected) world.append(node);
    }
    layout();
  }

  function render(nextWs, nextFlow, nextRun, nextAnalysis, nextSelectedId) {
    // A block selected from outside (e.g. a link in the details) replaces a selected edge, so Delete removes the block.
    if (nextSelectedId != null && nextSelectedId !== selectedId) selectedEdge = null;
    ws = nextWs; flow = nextFlow; run = nextRun; analysis = nextAnalysis ?? new Map(); selectedId = nextSelectedId ?? null;
    for (const [id, p] of pending) {
      const b = flow.blocks.find(x => x.id === id);
      if (!b || (b.x === p.x && b.y === p.y)) pending.delete(id);
    }
    paint();
    if (!placed && flow.blocks.length && root.clientWidth) fit();
    else applyView();
  }

  // ---------- editing ----------
  const save = patch => Promise.resolve(onChange?.(patch));

  function selectEdge(edge) {
    selectedEdge = edge;
    onSelect?.(null);
    paint();
    root.focus({ preventScroll: true });
  }

  // Puts a new block at (x, y) on the grid, nudged off any block already there, and selects it.
  function placeBlock(make, x, y) {
    if (!flow) return Promise.resolve(null);
    const taken = p => flow.blocks.some(b => b.x === p.x && b.y === p.y);
    const p = { x: snap(x), y: snap(y) };
    while (taken(p)) { p.x += GRID * 2; p.y += GRID * 2; }
    const block = make(p);
    return save({ blocks: [...flow.blocks, block] }).then(res => {
      if (res?.ok === false) return null;
      onSelect?.(block.id);
      return block.id;
    });
  }

  function addBlockAt(requestId, x, y) {
    placeBlock(p => ({ id: newId(), kind: 'request', requestId, x: p.x, y: p.y, outputs: [] }), x, y);
  }

  const centerWorld = () => {
    const [cx, cy] = centerPoint();
    return [(cx - view.x) / view.k - W / 2, (cy - view.y) / view.k - PORT_Y];
  };

  function addRequest(requestId) {
    addBlockAt(requestId, ...centerWorld());
  }

  function addLogic() {
    placeBlock(p => newLogicBlock({ id: newId(), x: p.x, y: p.y }), ...centerWorld()).then(id => { if (id) onLogicAdded?.(id); });
  }

  function duplicateBlock(b) {
    placeBlock(p => ({ ...structuredClone(b), id: newId(), x: p.x, y: p.y }), b.x + GRID * 2, b.y + GRID * 2);
  }

  function removeBlock(id) {
    if (!flow) return;
    save({ blocks: flow.blocks.filter(b => b.id !== id), edges: flow.edges.filter(e => e.from !== id && e.to !== id) });
    if (selectedId === id) onSelect?.(null);
  }

  function removeSelection() {
    if (selectedEdge) {
      const edge = selectedEdge;
      selectedEdge = null;
      save({ edges: flow.edges.filter(e => !sameEdge(e, edge)) });
      paint();
    } else if (selectedId && flow?.blocks.some(b => b.id === selectedId)) {
      removeBlock(selectedId);
    }
  }

  function connect(from, to) {
    if (!to || from === to || flow.edges.some(e => e.from === from && e.to === to)) return;
    // to → … → from already exists: from → to would close a loop.
    if (upstream(flow, from).has(to)) { toast("Blocks can't connect in a loop."); return; }
    save({ edges: [...flow.edges, { from, to }] });
  }

  function menuFor(b, x, y) {
    const entry = analysis.get(b.id);
    const outdatedIds = flow.blocks.filter(o => {
      const fp = currentFingerprint(o);
      return fp !== null && blockStatus(run, o.id, fp).outdated;
    }).map(o => o.id);
    const changed = envChanged(run, ws.activeEnvId, envVars(ws));
    const from = runFromHere(run, flow, b.id, { envChanged: changed, outdatedIds });
    const items = [{ label: 'Run from here', icon: 'play', disabled: !from.enabled || !onRunFrom, action: () => onRunFrom(b.id) }];
    if (from.enabled && from.warn) items.push({ label: from.warn, disabled: true, className: 'menu-note', action: () => {} });
    if (isLogic(b)) items.push({ label: 'Duplicate', icon: 'copy', action: () => duplicateBlock(b) });
    else items.push({ label: 'Open request', icon: 'edit', disabled: !entry?.request || !onOpenRequest, action: () => onOpenRequest(b.requestId) });
    items.push('sep', { label: 'Delete', icon: 'trash', danger: true, action: () => removeBlock(b.id) });
    showMenu(x, y, items);
  }

  // Follows one pointer until it is released or cancelled; destroy() cancels it too.
  let stopTracking = null;
  function track(e, { move, end }) {
    stopTracking?.(true);
    const pid = e.pointerId;
    const onMove = ev => { if (ev.pointerId === pid) move(ev); };
    const onUp = ev => { if (ev.pointerId === pid) stop(false, ev); };
    const onCancel = ev => { if (ev.pointerId === pid) stop(true, ev); };
    function stop(cancelled, ev) {
      removeEventListener('pointermove', onMove);
      removeEventListener('pointerup', onUp);
      removeEventListener('pointercancel', onCancel);
      stopTracking = null;
      end(ev, cancelled);
    }
    addEventListener('pointermove', onMove);
    addEventListener('pointerup', onUp);
    addEventListener('pointercancel', onCancel);
    stopTracking = cancelled => stop(cancelled, null);
  }

  // A press on a block: under 4px of travel it selects, otherwise it moves the block.
  function startMove(e, id) {
    const b = flow.blocks.find(x => x.id === id);
    if (!b) return;
    const sx = e.clientX, sy = e.clientY, origin = posOf(b);
    let moved = false;
    track(e, {
      move: ev => {
        if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
        moved = true;
        drag = { id, x: snap(origin.x + (ev.clientX - sx) / view.k), y: snap(origin.y + (ev.clientY - sy) / view.k) };
        nodes.get(id)?.classList.add('dragging');
        layout();
      },
      end: async (ev, cancelled) => {
        const last = drag;
        drag = null;
        nodes.get(id)?.classList.remove('dragging');
        if (cancelled) { if (last) layout(); return; }
        if (!moved) { selectedEdge = null; onSelect?.(id); return; }
        const { x, y } = last;
        if (x === b.x && y === b.y) { layout(); return; }
        pending.set(id, { x, y });
        paint();
        const res = await save({ blocks: flow.blocks.map(o => (o.id === id ? { ...o, x, y } : o)) });
        if (res?.ok === false) { pending.delete(id); paint(); }
      },
    });
  }

  // Drag from an out-port; dropping on another block (its in-port or body) adds the edge.
  function startConnect(e, from) {
    const b = flow.blocks.find(x => x.id === from);
    const p = posOf(b), x1 = p.x + W, y1 = p.y + PORT_Y;
    const temp = svgEl('path', { class: 'linking' });
    track(e, {
      move: ev => {
        const q = toWorld(ev.clientX, ev.clientY), c = Math.max(50, (q.x - x1) / 2);
        temp.setAttribute('d', `M${x1} ${y1} C ${x1 + c} ${y1}, ${q.x - c} ${q.y}, ${q.x} ${q.y}`);
        if (!temp.isConnected) edgesSvg.append(temp);
      },
      end: (ev, cancelled) => {
        temp.remove();
        if (cancelled) return;
        const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.canvas .node');
        if (target && root.contains(target)) connect(from, target.dataset.id);
      },
    });
  }

  function makeNode(id) {
    const node = el('div', { class: 'node', tabindex: '0', role: 'button', dataset: { id } });
    node.addEventListener('pointerdown', e => {
      if (spaceDown || e.button !== 0) return; // Space + drag pans, even over a block
      e.stopPropagation();
      if (e.target.closest('.port.out')) startConnect(e, id);
      else startMove(e, id);
    });
    node.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); selectedEdge = null; onSelect?.(id); }
    });
    node.addEventListener('contextmenu', e => {
      e.preventDefault();
      e.stopPropagation();
      const b = flow?.blocks.find(x => x.id === id);
      if (b) menuFor(b, e.clientX, e.clientY);
    });
    // Tab may land on a block outside the view: bring it in instead of scrolling the canvas.
    // A mouse press focuses too, but must not move the view under the pointer.
    node.addEventListener('focus', () => {
      root.scrollLeft = 0; root.scrollTop = 0;
      if (!node.matches(':focus-visible')) return;
      const r = node.getBoundingClientRect(), c = root.getBoundingClientRect();
      if (r.left < c.left || r.right > c.right || r.top < c.top || r.bottom > c.bottom) center(id);
    });
    nodes.set(id, node);
    return node;
  }

  // ---------- pan, zoom and keys ----------
  let pan = null;
  root.addEventListener('pointerdown', e => {
    if (e.target.closest('.zoom') || (e.button !== 0 && e.button !== 1)) return;
    if (!spaceDown && e.target.closest('.node')) return;
    pan = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false, id: e.pointerId };
    root.setPointerCapture(e.pointerId);
    root.classList.add('drag');
    root.focus({ preventScroll: true });
  });
  root.addEventListener('pointermove', e => {
    if (!pan) return;
    const dx = e.clientX - pan.sx, dy = e.clientY - pan.sy;
    if (!pan.moved && Math.hypot(dx, dy) < 4) return;
    pan.moved = true;
    setView({ ...view, x: pan.vx + dx, y: pan.vy + dy });
  });
  const endPan = e => {
    if (!pan) return;
    const clicked = !pan.moved && e.type === 'pointerup' && !spaceDown;
    pan = null;
    root.classList.remove('drag');
    if (clicked) { selectedEdge = null; onSelect?.(null); paint(); }
  };
  root.addEventListener('pointerup', endPan);
  root.addEventListener('pointercancel', endPan);
  root.addEventListener('contextmenu', e => { if (!e.target.closest('.node')) e.preventDefault(); });

  root.addEventListener('wheel', e => {
    e.preventDefault();
    const r = root.getBoundingClientRect();
    // Pinch arrives as ctrl+wheel; a mouse wheel moves in big vertical steps; a trackpad scroll pans.
    const wheel = e.deltaMode !== 0 || (Math.abs(e.deltaY) >= 50 && !e.deltaX);
    if (e.ctrlKey || e.metaKey || wheel) {
      const step = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      setView(zoomAt(view, view.k * Math.exp(-step * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top));
    } else {
      setView({ ...view, x: view.x - e.deltaX, y: view.y - e.deltaY });
    }
  }, { passive: false });

  root.addEventListener('keydown', e => {
    if (isEditable(e.target)) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomBy(1.25); }
    else if (mod && e.key === '-') { e.preventDefault(); zoomBy(1 / 1.25); }
    else if (mod && e.key === '0') { e.preventDefault(); zoomTo(1); }
    else if (e.shiftKey && e.code === 'Digit1') { e.preventDefault(); fit(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSelection(); }
  });
  root.addEventListener('scroll', () => { root.scrollLeft = 0; root.scrollTop = 0; });
  root.addEventListener('pointerenter', () => { hover = true; });
  root.addEventListener('pointerleave', () => { hover = false; });
  const onSpace = e => {
    if (e.key !== ' ' || isEditable(e.target)) return;
    const down = e.type === 'keydown';
    if (down && !hover && !root.contains(document.activeElement)) return;
    if (down) e.preventDefault();
    spaceDown = down;
    root.classList.toggle('space', down);
  };
  document.addEventListener('keydown', onSpace);
  document.addEventListener('keyup', onSpace);

  // Requests dragged from the collection tree.
  root.addEventListener('dragover', e => {
    if (!e.dataTransfer?.types.includes(DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  root.addEventListener('drop', e => {
    const requestId = e.dataTransfer?.getData(DRAG_TYPE);
    if (!requestId) return;
    e.preventDefault();
    const p = toWorld(e.clientX, e.clientY);
    addBlockAt(requestId, p.x - W / 2, p.y - PORT_Y);
  });

  const resize = new ResizeObserver(() => {
    if (!placed && flow?.blocks.length && root.clientWidth) fit();
  });
  resize.observe(root);
  applyView();

  return {
    render,
    center,
    fit,
    addRequest,
    addLogic,
    destroy() {
      stopTracking?.(true);
      resize.disconnect();
      document.removeEventListener('keydown', onSpace);
      document.removeEventListener('keyup', onSpace);
      if (saveTimer) { clearTimeout(saveTimer); store?.set(viewKey, view); }
      root.remove();
    },
  };
}
