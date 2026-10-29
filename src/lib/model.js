// Workspace: collections → folders → requests, plus environments.
// Item: { id, type: 'collection'|'folder'|'request', parentId, order, name, updatedAt, deleted, ...request fields }
// Environment: { id, name, order, vars: [{key, value, secret}], updatedAt, deleted }

export const newId = () => crypto.randomUUID();

export function newRequest(fields = {}) {
  return {
    method: 'GET',
    url: '',
    headers: [],
    body: { mode: 'none', raw: '', fields: [] },
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

export function pathOf(ws, id) {
  const names = [];
  for (let item = ws.items[id]; item; item = ws.items[item.parentId]) names.unshift(item.name);
  return names;
}

const isContainer = item => item && !item.deleted && (item.type === 'collection' || item.type === 'folder');
const REQUEST_FIELDS = ['method', 'url', 'headers', 'body', 'name'];
const MOCK_FIELDS = ['status', 'headers', 'body', 'delayMs'];

function isDescendant(ws, id, ancestorId) {
  for (let item = ws.items[id]; item; item = ws.items[item.parentId]) {
    if (item.id === ancestorId) return true;
  }
  return false;
}

// Pure: returns { workspace } with new objects, or { error }.
export function applyMutation(ws, m, now) {
  const next = { items: { ...ws.items }, environments: { ...ws.environments }, activeEnvId: ws.activeEnvId };
  const touch = (id, patch) => { next.items[id] = { ...next.items[id], ...patch, updatedAt: now }; };
  const touchEnv = (id, patch) => { next.environments[id] = { ...next.environments[id], ...patch, updatedAt: now }; };
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
      if (m.type === 'setMockEnabled') patch.enabled = Boolean(m.enabled);
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
    default:
      return { error: 'bad_mutation' };
  }
}
