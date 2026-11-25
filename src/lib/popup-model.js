// What the toolbar popup shows, and what turning a mock on needs for the current tab.

import { children, liveRequests, pathOf } from './model.js';
import { deriveActiveMocks } from './mocks.js';
import { envVars, resolveVars } from './vars.js';

const isWebOrigin = origin => /^https?:\/\//.test(origin ?? '');

// 'none': just toggle. 'add': register the site first. 'grant': ask for host access first.
export function siteStep({ origin, mockSites, hasAccess }) {
  if (!isWebOrigin(origin)) return 'none';
  if (!hasAccess) return 'grant';
  return mockSites.includes(origin) ? 'none' : 'add';
}

// Every live request, in the order the collection tree shows them. Requests the tree
// can't reach (sync can delete a folder another device just added to) go last, since
// their mocks still run.
function requestsInTreeOrder(ws) {
  const out = [];
  const walk = parentId => {
    for (const item of children(ws, parentId)) {
      if (item.type === 'request') out.push(item);
      else walk(item.id);
    }
  };
  walk(null);
  const seen = new Set(out.map(r => r.id));
  return [...out, ...liveRequests(ws).filter(r => !seen.has(r.id))];
}

export function popupView(ws, { mockSites, tabOrigin, hasAccess }) {
  const vars = envVars(ws);
  const rows = requestsInTreeOrder(ws)
    .map(r => {
      const { value, missing } = resolveVars(r.url, vars);
      return {
        id: r.id,
        method: r.method,
        name: r.name,
        url: missing.length ? r.url : value.replace(/^https?:\/\//, ''),
        status: r.mock.status,
        path: pathOf(ws, r.id).slice(0, -1).join(' / '),
        enabled: r.mock.enabled,
        missing,
      };
    });
  const liveCount = deriveActiveMocks(ws).length;
  const env = ws.environments[ws.activeEnvId];
  const web = isWebOrigin(tabOrigin);
  const siteActive = web && hasAccess && mockSites.includes(tabOrigin);
  return {
    rows,
    liveCount,
    idleCount: rows.filter(r => r.enabled).length - liveCount,
    envName: env && !env.deleted ? env.name : 'No environment',
    siteActive,
    showBanner: web && !siteActive && liveCount > 0,
  };
}

const words = query => String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);

// Rows where every word of the query appears in the method, name, url or path.
export function filterRows(rows, query) {
  const terms = words(query);
  if (!terms.length) return rows;
  return rows.filter(r => {
    const text = `${r.method} ${r.name} ${r.url} ${r.path}`.toLowerCase();
    return terms.every(t => text.includes(t));
  });
}

// Where the query's words appear in text, as sorted, merged [start, end) ranges.
export function matchRanges(text, query) {
  const lower = String(text).toLowerCase();
  const ranges = [];
  for (const term of words(query)) {
    for (let i = lower.indexOf(term); i !== -1; i = lower.indexOf(term, i + 1)) ranges.push([i, i + term.length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [start, end] of ranges) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}
