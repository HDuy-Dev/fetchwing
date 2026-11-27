// Flow graph analysis: which variables each block uses and where they come from.

import { VAR_PATTERN } from './vars.js';

export function usedVars(request) {
  const texts = [request.url];
  for (const h of request.headers || []) if (h.enabled) texts.push(h.key, h.value);
  const body = request.body || {};
  if (body.mode === 'urlencoded' || body.mode === 'formdata') {
    for (const f of body.fields || []) if (f.enabled) texts.push(f.key, f.value);
  } else {
    texts.push(body.raw);
  }
  const names = new Set();
  for (const t of texts) {
    for (const m of String(t ?? '').matchAll(VAR_PATTERN)) names.add(m[1]);
  }
  return [...names].sort();
}

export function upstream(flow, blockId) {
  const seen = new Set();
  const stack = [blockId];
  while (stack.length) {
    const id = stack.pop();
    for (const e of flow.edges) {
      if (e.to === id && !seen.has(e.from)) {
        seen.add(e.from);
        stack.push(e.from);
      }
    }
  }
  seen.delete(blockId);
  return seen;
}

export function topoOrder(flow) {
  const ids = flow.blocks.map(b => b.id);
  const known = new Set(ids);
  const indeg = new Map(ids.map(id => [id, 0]));
  const edges = flow.edges.filter(e => known.has(e.from) && known.has(e.to));
  for (const e of edges) indeg.set(e.to, indeg.get(e.to) + 1);
  const out = [];
  const done = new Set();
  const queue = ids.filter(id => indeg.get(id) === 0);
  while (queue.length) {
    const id = queue.shift();
    out.push(id);
    done.add(id);
    for (const e of edges) {
      if (e.from !== id) continue;
      indeg.set(e.to, indeg.get(e.to) - 1);
      if (indeg.get(e.to) === 0) queue.push(e.to);
    }
  }
  for (const id of ids) if (!done.has(id)) out.push(id); // cycle members, in block order
  return out;
}

function requestOf(ws, block) {
  const item = ws.items[block.requestId];
  return item && item.type === 'request' && !item.deleted ? item : null;
}

export function analyzeFlow(ws, flow, envVars) {
  const info = new Map();
  const has = (obj, k) => Object.prototype.hasOwnProperty.call(obj || {}, k);
  for (const block of flow.blocks) {
    const request = requestOf(ws, block);
    const entry = { request, uses: [], missing: [], conflicts: [], deleted: !request };
    info.set(block.id, entry);
    if (!request) continue;
    const ups = upstream(flow, block.id);
    const upBlocks = flow.blocks.filter(b => ups.has(b.id));
    for (const name of usedVars(request)) {
      const providers = upBlocks.filter(b => (b.outputs || []).some(o => o.name === name));
      // The nearest provider wins: drop any provider that is upstream of another provider.
      const nearest = providers.filter(p => !providers.some(q => q !== p && upstream(flow, q.id).has(p.id)));
      if (nearest.length === 1) entry.uses.push({ name, from: nearest[0].id });
      else if (nearest.length > 1) {
        entry.uses.push({ name, from: null });
        entry.conflicts.push(name);
      } else if (has(envVars, name)) entry.uses.push({ name, from: 'env' });
      else {
        entry.uses.push({ name, from: null });
        entry.missing.push(name);
      }
    }
  }
  return info;
}

export function edgeVars(ws, flow, edge) {
  const from = flow.blocks.find(b => b.id === edge.from);
  const to = flow.blocks.find(b => b.id === edge.to);
  const request = to && requestOf(ws, to);
  if (!from || !request) return [];
  const used = new Set(usedVars(request));
  return [...new Set((from.outputs || []).map(o => o.name))].filter(n => used.has(n));
}

export function blockFingerprint(request, envVars) {
  const names = usedVars(request);
  const mock = request.mock?.enabled
    ? { status: request.mock.status, headers: request.mock.headers, body: request.mock.body, delayMs: request.mock.delayMs }
    : null;
  const env = {};
  for (const n of names) env[n] = Object.prototype.hasOwnProperty.call(envVars || {}, n) ? envVars[n] : null;
  return JSON.stringify({
    method: request.method,
    url: request.url,
    headers: request.headers,
    body: request.body,
    mock,
    env,
  });
}
