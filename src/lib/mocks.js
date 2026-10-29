// Which mocks are live, as the flat list the page runtime consumes.

import { liveRequests } from './model.js';
import { envVars, resolveVars } from './vars.js';
import { matchKey, normalizeUrl } from './match.js';

function keyFor(request, vars) {
  const { value, missing } = resolveVars(request.url, vars);
  if (missing.length || !value.trim()) return null;
  return { key: matchKey(request.method, value), url: normalizeUrl(value) };
}

export function deriveActiveMocks(ws) {
  const vars = envVars(ws);
  const list = [];
  for (const r of liveRequests(ws)) {
    if (!r.mock.enabled) continue;
    const k = keyFor(r, vars);
    if (!k) continue;
    list.push({
      key: k.key,
      method: String(r.method).toUpperCase(),
      url: k.url,
      status: r.mock.status,
      headers: r.mock.headers,
      body: r.mock.body,
      delayMs: r.mock.delayMs,
      requestId: r.id,
      name: r.name,
    });
  }
  return list;
}

// Another enabled mock that would answer the same request.
export function findDuplicate(ws, requestId) {
  const vars = envVars(ws);
  const target = ws.items[requestId];
  const k = target && keyFor(target, vars);
  if (!k) return null;
  return liveRequests(ws).find(r => r.id !== requestId && r.mock.enabled && keyFor(r, vars)?.key === k.key) ?? null;
}
