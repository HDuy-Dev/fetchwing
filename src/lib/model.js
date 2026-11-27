// Workspace: collections → folders → requests, plus environments.
// Item: { id, type: 'collection'|'folder'|'request', parentId, order, name, updatedAt, deleted, ...request fields }
// Environment: { id, name, order, vars: [{key, value, secret}], updatedAt, deleted }
// Flow: { id, name, order, updatedAt, deleted, blocks: [{ id, kind: 'request', requestId, x, y, outputs: [{name, path}] }], edges: [{ from, to }] }

export const newId = () => crypto.randomUUID();

export function newRequest(fields = {}) {
  return {
    method: 'GET',
    url: '',
    headers: [],
    body: { mode: 'none', raw: '', fields: [] },
    script: '',
    mock: { enabled: false, status: 200, headers: [], body: '', delayMs: 0 },
    ...fields,
  };
}

export function emptyWorkspace() {
  const collectionId = newId();
  const envId = newId();
  return {
    items: {
      [collectionId]: { id: collectionId, type: 'collection', parentId: null, order: 0, name: 'My Collection', updatedAt: 0, deleted: false },
    },
    environments: {
      [envId]: { id: envId, name: 'Local', order: 0, vars: [], updatedAt: 0, deleted: false },
    },
    activeEnvId: envId,
    flows: {},
  };
}

export function children(ws, parentId) {
  return Object.values(ws.items)
    .filter(i => i.parentId === parentId && !i.deleted)
    .sort((a, b) => a.order - b.order);
}

export function liveRequests(ws) {
  return Object.values(ws.items).filter(i => i.type === 'request' && !i.deleted);
}

export function liveEnvironments(ws) {
  return Object.values(ws.environments).filter(e => !e.deleted).sort((a, b) => a.order - b.order);
}

export function liveFlows(ws) {
  return Object.values(ws.flows ?? {}).filter(f => !f.deleted).sort((a, b) => a.order - b.order);
}

export function pathOf(ws, id) {
  const names = [];
  for (let item = ws.items[id]; item; item = ws.items[item.parentId]) names.unshift(item.name);
  return names;
}

function validEdges(blocks, edges) {
  const ids = new Set(blocks.map(b => b.id));
  const seen = new Set();
  for (const { from, to } of edges) {
    const key = `${from}\0${to}`;
    if (from === to || !ids.has(from) || !ids.has(to) || seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

function hasCycle(edges) {
  const out = new Map();
  for (const { from, to } of edges) out.set(from, [...(out.get(from) ?? []), to]);
  const state = new Map(); // 1 = on the DFS stack, 2 = done
  const visit = id => {
    if (state.get(id) === 1) return true;
    if (state.get(id) === 2) return false;
    state.set(id, 1);
    for (const to of out.get(id) ?? []) if (visit(to)) return true;
    state.set(id, 2);
    return false;
  };
  return [...out.keys()].some(visit);
}

const isContainer = item => item && !item.deleted && (item.type === 'collection' || item.type === 'folder');
const REQUEST_FIELDS = ['method', 'url', 'headers', 'body', 'script', 'name'];
const MOCK_FIELDS = ['status', 'headers', 'body', 'delayMs'];

function isDescendant(ws, id, ancestorId) {
  for (let item = ws.items[id]; item; item = ws.items[item.parentId]) {
    if (item.id === ancestorId) return true;
  }
  return false;
}

// Pure: returns { workspace } with new objects, or { error }.
export function applyMutation(ws, m, now) {
  const next = { items: { ...ws.items }, environments: { ...ws.environments }, activeEnvId: ws.activeEnvId, flows: { ...(ws.flows ?? {}) } };
  const touch = (id, patch) => { next.items[id] = { ...next.items[id], ...patch, updatedAt: now }; };
  const touchEnv = (id, patch) => { next.environments[id] = { ...next.environments[id], ...patch, updatedAt: now }; };
  const touchFlow = (id, patch) => { next.flows[id] = { ...next.flows[id], ...patch, updatedAt: now }; };
  const liveFlow = id => next.flows[id] && !next.flows[id].deleted ? next.flows[id] : null;
  const live = id => next.items[id] && !next.items[id].deleted ? next.items[id] : null;
  const liveEnv = id => next.environments[id] && !next.environments[id].deleted ? next.environments[id] : null;
  const reorder = (parentId, ids) => ids.forEach((id, order) => {
    if (next.items[id].order !== order || next.items[id].parentId !== parentId) touch(id, { parentId, order });
  });

  switch (m.type) {
    case 'addItem': {
      const valid = m.itemType === 'collection' ? m.parentId === null : isContainer(live(m.parentId));
      if (!valid || !['collection', 'folder', 'request'].includes(m.itemType)) return { error: 'invalid_parent' };
      const order = children(next, m.parentId).length;
      const name = String(m.name ?? '').trim() || 'Untitled';
      const base = { id: m.id, type: m.itemType, parentId: m.parentId, order, name, updatedAt: now, deleted: false };
      next.items[m.id] = m.itemType === 'request' ? { ...base, ...newRequest(m.fields) } : base;
      return { workspace: next };
    }
    case 'renameItem': {
      if (!live(m.id)) return { error: 'not_found' };
      const name = String(m.name ?? '').trim();
      if (!name) return { error: 'empty_name' };
      touch(m.id, { name });
      return { workspace: next };
    }
    case 'updateRequest': {
      const item = live(m.id);
      if (!item || item.type !== 'request') return { error: 'not_found' };
      const patch = {};
      for (const k of REQUEST_FIELDS) if (k in m.patch) patch[k] = m.patch[k];
      if ('name' in patch && !String(patch.name).trim()) return { error: 'empty_name' };
      touch(m.id, patch);
      return { workspace: next };
    }
    case 'moveItem': {
      const item = live(m.id);
      if (!item) return { error: 'not_found' };
      const toRoot = m.parentId === null;
      if (toRoot !== (item.type === 'collection')) return { error: 'invalid_move' };
      if (!toRoot && (!isContainer(live(m.parentId)) || isDescendant(next, m.parentId, m.id))) return { error: 'invalid_move' };
      const oldParent = item.parentId;
      const siblings = children(next, m.parentId).map(i => i.id).filter(id => id !== m.id);
      siblings.splice(Math.max(0, Math.min(m.order, siblings.length)), 0, m.id);
      reorder(m.parentId, siblings);
      if (oldParent !== m.parentId) reorder(oldParent, children(next, oldParent).map(i => i.id).filter(id => id !== m.id));
      return { workspace: next };
    }
    case 'deleteItem': {
      if (!live(m.id)) return { error: 'not_found' };
      const stack = [m.id];
      while (stack.length) {
        const id = stack.pop();
        stack.push(...children(next, id).map(i => i.id));
        touch(id, { deleted: true });
      }
      return { workspace: next };
    }
    case 'updateMock':
    case 'setMockEnabled': {
      const item = live(m.id);
      if (!item || item.type !== 'request') return { error: 'not_found' };
      const patch = {};
      if (m.type === 'setMockEnabled') {
        patch.enabled = Boolean(m.enabled);
        // Remembered so the mock stays in the Mocks lists after it is turned off.
        if (patch.enabled) patch.everEnabled = true;
      }
      else for (const k of MOCK_FIELDS) if (k in m.patch) patch[k] = m.patch[k];
      touch(m.id, { mock: { ...item.mock, ...patch } });
      return { workspace: next };
    }
    case 'disableAllMocks': {
      for (const r of liveRequests(next)) {
        if (r.mock.enabled) touch(r.id, { mock: { ...r.mock, enabled: false } });
      }
      return { workspace: next };
    }
    case 'addEnvironment': {
      const order = liveEnvironments(next).length;
      next.environments[m.id] = { id: m.id, name: String(m.name ?? '').trim() || 'Environment', order, vars: [], updatedAt: now, deleted: false };
      return { workspace: next };
    }
    case 'updateEnvironment': {
      if (!liveEnv(m.id)) return { error: 'not_found' };
      const patch = {};
      if ('name' in m.patch) {
        const name = String(m.patch.name).trim();
        if (!name) return { error: 'empty_name' };
        patch.name = name;
      }
      if ('vars' in m.patch) patch.vars = m.patch.vars.map(v => ({ key: String(v.key), value: String(v.value), secret: Boolean(v.secret) }));
      touchEnv(m.id, patch);
      return { workspace: next };
    }
    case 'applyEnvChanges': {
      const env = liveEnv(m.id);
      if (!env) return { error: 'not_found' };
      const vars = env.vars.map(v => ({ ...v }));
      for (const c of m.changes ?? []) {
        const key = String(c.key ?? '');
        if (!key) continue;
        const at = vars.findIndex(v => v.key === key);
        if (c.op === 'unset') { if (at !== -1) vars.splice(at, 1); }
        else if (c.op === 'set') {
          const value = String(c.value ?? '');
          if (at === -1) vars.push({ key, value, secret: false });
          else vars[at] = { ...vars[at], value };
        }
      }
      touchEnv(m.id, { vars });
      return { workspace: next };
    }
    case 'deleteEnvironment': {
      if (!liveEnv(m.id)) return { error: 'not_found' };
      touchEnv(m.id, { deleted: true });
      if (next.activeEnvId === m.id) next.activeEnvId = liveEnvironments(next)[0]?.id ?? null;
      return { workspace: next };
    }
    case 'setActiveEnv': {
      if (m.id !== null && !liveEnv(m.id)) return { error: 'not_found' };
      next.activeEnvId = m.id;
      return { workspace: next };
    }
    case 'addFlow': {
      const order = liveFlows(next).length;
      next.flows[m.id] = { id: m.id, name: String(m.name ?? '').trim() || 'Untitled flow', order, updatedAt: now, deleted: false, blocks: [], edges: [] };
      return { workspace: next };
    }
    case 'updateFlow': {
      const flow = liveFlow(m.id);
      if (!flow) return { error: 'not_found' };
      const patch = {};
      if ('name' in m.patch) {
        const name = String(m.patch.name).trim();
        if (!name) return { error: 'empty_name' };
        patch.name = name;
      }
      if ('blocks' in m.patch) patch.blocks = m.patch.blocks;
      if ('edges' in m.patch) patch.edges = m.patch.edges;
      const blocks = patch.blocks ?? flow.blocks;
      const edges = patch.edges ?? flow.edges;
      if (!validEdges(blocks, edges)) return { error: 'invalid_edge' };
      if (hasCycle(edges)) return { error: 'cycle' };
      touchFlow(m.id, patch);
      return { workspace: next };
    }
    case 'deleteFlow': {
      if (!liveFlow(m.id)) return { error: 'not_found' };
      touchFlow(m.id, { deleted: true });
      return { workspace: next };
    }
    default:
      return { error: 'bad_mutation' };
  }
}
