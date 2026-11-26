// Drive sync merge rules: the later edit wins per item and per environment.
// Secret values, mock on/off and the active environment never leave the device.

export const REMOTE_VERSION = 1;

const clone = v => structuredClone(v);

// What goes into the Drive file.
export function toRemote(ws) {
  const items = {};
  for (const [id, item] of Object.entries(ws.items)) {
    items[id] = clone(item);
    if (items[id].mock) items[id].mock.enabled = false;
  }
  const environments = {};
  for (const [id, env] of Object.entries(ws.environments)) {
    environments[id] = { ...clone(env), vars: env.vars.map(v => (v.secret ? { ...v, value: '' } : { ...v })) };
  }
  const flows = {};
  for (const [id, flow] of Object.entries(ws.flows ?? {})) flows[id] = clone(flow);
  return { version: REMOTE_VERSION, items, environments, flows };
}

// Only the defaults from emptyWorkspace(): nothing the user made.
export function isPristine(ws) {
  return [...Object.values(ws.items), ...Object.values(ws.environments), ...Object.values(ws.flows ?? {})].every(x => x.updatedAt === 0);
}

function withLocalItemState(remoteItem, localItem) {
  const out = clone(remoteItem);
  if (out.mock) out.mock.enabled = Boolean(localItem?.mock?.enabled);
  return out;
}

function withLocalSecrets(remoteEnv, localEnv) {
  const secrets = new Map((localEnv?.vars ?? []).filter(v => v.secret).map(v => [v.key, v.value]));
  return { ...clone(remoteEnv), vars: remoteEnv.vars.map(v => (v.secret ? { ...v, value: secrets.get(v.key) ?? '' } : { ...v })) };
}

function mergeMap(local, remote, adopt) {
  const out = {};
  let upload = false;
  for (const id of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const l = local[id];
    const r = remote[id];
    if (l && (!r || l.updatedAt >= r.updatedAt)) {
      out[id] = clone(l);
      if (!r || l.updatedAt > r.updatedAt) upload = true;
    } else {
      out[id] = adopt(r, l);
    }
  }
  return { map: out, upload };
}

// Newer than an untouched default (0) and older than any real edit, so folding
// an environment never overwrites variables added on a device that had not synced.
const FOLDED_AT = 1;

// The default "Local" environment is duplicated the same way. An untouched one
// holds no variables, so it folds into the "Local" someone has edited, or else
// into the untouched one with the smallest id.
function foldDefaultEnvironments(environments) {
  const out = { ...environments };
  const live = Object.values(out).filter(e => !e.deleted);
  const defaults = live.filter(e => e.updatedAt === 0).map(e => e.id).sort();
  const edited = live.filter(e => e.updatedAt > 0 && e.name === 'Local').map(e => e.id).sort();
  const keep = edited[0] ?? defaults[0];
  const extra = defaults.filter(id => id !== keep);
  for (const id of extra) out[id] = { ...out[id], deleted: true, mergedInto: keep, updatedAt: FOLDED_AT };
  return { environments: out, changed: extra.length > 0 };
}

function pickActiveEnv(environments, current) {
  // A folded environment hands the selection to the one it went into.
  while (environments[current]?.deleted && environments[current].mergedInto) current = environments[current].mergedInto;
  if (current && environments[current] && !environments[current].deleted) return current;
  const live = Object.values(environments).filter(e => !e.deleted).sort((a, b) => a.order - b.order);
  return live[0]?.id ?? null;
}

// Every device starts with its own default collection under a random id, so
// merging by id alone keeps one per device. Collections nobody has edited are
// folded into the one with the smallest id, which every device picks alike.
// A folded collection remembers where it went (mergedInto), so requests another
// device added to it before syncing follow along.
function foldDefaultCollections(items, now) {
  const out = { ...items };
  let changed = false;
  const touch = (id, patch) => {
    out[id] = { ...out[id], ...patch, updatedAt: now };
    changed = true;
  };

  const [keep, ...extra] = Object.values(out)
    .filter(i => i.type === 'collection' && !i.deleted && i.updatedAt === 0)
    .map(i => i.id)
    .sort();
  for (const id of extra) touch(id, { deleted: true, mergedInto: keep });

  const destination = id => {
    while (out[id]?.mergedInto) id = out[id].mergedInto;
    return id;
  };
  const strays = Object.values(out)
    .filter(i => !i.deleted && out[i.parentId]?.mergedInto)
    .sort((a, b) => a.order - b.order || a.updatedAt - b.updatedAt || a.id.localeCompare(b.id));
  for (const stray of strays) {
    const parentId = destination(stray.parentId);
    const order = Object.values(out).filter(i => i.parentId === parentId && !i.deleted).length;
    touch(stray.id, { parentId, order });
  }
  return { items: out, changed };
}

// remote: a toRemote() object, or null when there is no Drive file yet.
export function mergeRemote(local, remote, now = Date.now()) {
  if (!remote) return { workspace: clone(local), upload: true };
  const base = isPristine(local) ? { items: {}, environments: {}, activeEnvId: null } : local;
  const items = mergeMap(base.items, remote.items ?? {}, withLocalItemState);
  const envs = mergeMap(base.environments, remote.environments ?? {}, withLocalSecrets);
  const flows = mergeMap(base.flows ?? {}, remote.flows ?? {}, r => clone(r));
  const folded = foldDefaultCollections(items.map, now);
  const foldedEnvs = foldDefaultEnvironments(envs.map);
  return {
    workspace: { items: folded.items, environments: foldedEnvs.environments, flows: flows.map, activeEnvId: pickActiveEnv(foldedEnvs.environments, base.activeEnvId) },
    upload: items.upload || envs.upload || flows.upload || folded.changed || foldedEnvs.changed,
  };
}
