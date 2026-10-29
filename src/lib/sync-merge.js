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
  return { version: REMOTE_VERSION, items, environments };
}

// Only the defaults from emptyWorkspace(): nothing the user made.
export function isPristine(ws) {
  return [...Object.values(ws.items), ...Object.values(ws.environments)].every(x => x.updatedAt === 0);
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

function pickActiveEnv(environments, current) {
  if (current && environments[current] && !environments[current].deleted) return current;
  const live = Object.values(environments).filter(e => !e.deleted).sort((a, b) => a.order - b.order);
  return live[0]?.id ?? null;
}

// remote: a toRemote() object, or null when there is no Drive file yet.
export function mergeRemote(local, remote) {
  if (!remote) return { workspace: clone(local), upload: true };
  const base = isPristine(local) ? { items: {}, environments: {}, activeEnvId: null } : local;
  const items = mergeMap(base.items, remote.items ?? {}, withLocalItemState);
  const envs = mergeMap(base.environments, remote.environments ?? {}, withLocalSecrets);
  return {
    workspace: { items: items.map, environments: envs.map, activeEnvId: pickActiveEnv(envs.map, base.activeEnvId) },
    upload: items.upload || envs.upload,
  };
}
