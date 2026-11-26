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
