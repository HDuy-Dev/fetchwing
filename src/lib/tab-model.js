// The tab strip holds request and environment ids; the workspace says which is which.

export function tabKind(ws, id) {
  const item = ws.items[id];
  if (item) return !item.deleted && item.type === 'request' ? 'request' : null;
  const env = ws.environments[id];
  return env && !env.deleted ? 'env' : null;
}

// Opens right after afterId (or last); an open tab stays where it is.
export function insertTab(ids, id, afterId) {
  if (ids.includes(id)) return ids;
  const at = ids.indexOf(afterId);
  return at === -1 ? [...ids, id] : [...ids.slice(0, at + 1), id, ...ids.slice(at + 1)];
}

// Drops dead tabs. A dead selection passes to the next tab, else the previous one.
export function pruneTabs(ws, ids, selectedId) {
  const live = ids.filter(id => tabKind(ws, id));
  const alive = id => {
    const found = ws.items[id] ?? ws.environments[id];
    return Boolean(found) && !found.deleted;
  };
  if (!selectedId || alive(selectedId)) return { ids: live, selectedId };
  const at = ids.indexOf(selectedId);
  const next = at === -1 ? undefined : ids.slice(at + 1).find(id => live.includes(id));
  return { ids: live, selectedId: next ?? (at === -1 ? live.at(-1) : ids.slice(0, at).findLast(id => live.includes(id))) ?? null };
}
