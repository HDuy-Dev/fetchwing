// What the Environments dialog saves and shows, kept apart from its DOM.

export const copyName = name => `${name} copy`;

export const savableVars = vars => vars.filter(v => v.key || v.value);

export const hintName = vars => vars.find(v => v.key)?.key ?? 'baseUrl';

// A blank name is left out so it can't get the variables rejected with it.
export function envPatch(name, vars) {
  const patch = { vars: savableVars(vars) };
  if (name.trim()) patch.name = name;
  return patch;
}

// Whether the editor already shows what is saved. A blank name is never saved, so it is skipped.
export function sameEnv(name, vars, env) {
  const patch = envPatch(name, vars);
  if (patch.name !== undefined && patch.name.trim() !== env.name) return false;
  const flat = list => JSON.stringify(list.map(v => [v.key, v.value, Boolean(v.secret)]));
  return flat(patch.vars) === flat(env.vars);
}

export function filterEnvs(envs, query) {
  const needle = query.trim().toLowerCase();
  return needle ? envs.filter(e => e.name.toLowerCase().includes(needle)) : envs;
}

// The rows of the environment picker; the first and last stay whatever is searched.
export function pickerRows(envs, query, activeId) {
  return [
    { kind: 'none', active: !activeId },
    ...filterEnvs(envs, query).map(e => ({ kind: 'env', id: e.id, name: e.name, active: e.id === activeId })),
    { kind: 'create' },
  ];
}
