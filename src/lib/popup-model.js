// What the toolbar popup shows, and what turning a mock on needs for the current tab.

import { children, liveRequests } from './model.js';
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
