// {{name}} environment variables.

const VAR = /\{\{\s*([^{}]+?)\s*\}\}/g;

export function resolveVars(text, vars) {
  const missing = new Set();
  const value = String(text ?? '').replace(VAR, (whole, name) => {
    if (Object.prototype.hasOwnProperty.call(vars, name)) return vars[name];
    missing.add(name);
    return whole;
  });
  return { value, missing: [...missing] };
}

export function envVars(workspace) {
  const env = workspace.environments?.[workspace.activeEnvId];
  const vars = {};
  if (!env || env.deleted) return vars;
  for (const { key, value } of env.vars) {
    if (key) vars[key] = value;
  }
  return vars;
}

export function resolveRequest(request, vars) {
  const missing = new Set();
  const r = text => {
    const out = resolveVars(text, vars);
    out.missing.forEach(m => missing.add(m));
    return out.value;
  };
  const url = r(request.url);
  const headers = request.headers.filter(h => h.enabled && h.key).map(h => [r(h.key), r(h.value)]);
  const body = {
    mode: request.body.mode,
    raw: r(request.body.raw),
    fields: request.body.fields.map(f => (f.enabled ? { ...f, key: r(f.key), value: r(f.value) } : f)),
  };
  return { method: String(request.method).toUpperCase(), url, headers, body, missing: [...missing] };
}
