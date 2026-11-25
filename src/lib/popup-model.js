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

function problemOf(url, missing) {
  if (missing.length) return `Not running · Unresolved variable${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`;
  return url.trim() ? null : 'Not running · No URL';
}

// Collection and folder names above a request; empty when one of them is deleted
// (a request sync kept after its folder was removed elsewhere).
function folderPath(ws, request) {
  const names = [];
  for (let item = ws.items[request.parentId]; item; item = ws.items[item.parentId]) {
    if (item.deleted) return '';
    names.unshift(item.name);
  }
  return names.join(' / ');
}

// Splits a URL into its host (with any scheme left on it) and the rest.
function splitUrl(url) {
  const [, host, rest] = /^((?:[a-z][a-z0-9+.-]*:\/\/)?[^/?#]*)(.*)$/is.exec(url);
  return { host: host.toLowerCase(), rest: rest.startsWith('/') ? rest : `/${rest}` };
}

// Gives each row a url without the host, except where another host has the same
// method and path, since the host is then what tells the two apart.
function withShortUrls(rows) {
  const hosts = new Map(); // "METHOD rest" -> hosts using it
  const parsed = rows.map(row => {
    const parts = splitUrl(row.url);
    const key = `${row.method} ${parts.rest}`;
    if (!row.problem) hosts.set(key, (hosts.get(key) ?? new Set()).add(parts.host));
    return { row, key, rest: parts.rest };
  });
  return parsed.map(({ row, key, rest }) => ({ ...row, shortUrl: hosts.get(key)?.size > 1 ? row.url : rest }));
}

export function popupView(ws, { mockSites, tabOrigin, hasAccess }) {
  const vars = envVars(ws);
  const rows = requestsInTreeOrder(ws)
    .map(r => {
      const { value, missing } = resolveVars(r.url, vars);
      const url = missing.length ? r.url : value.replace(/^https?:\/\//, '');
      return {
        id: r.id,
        method: r.method,
        name: r.name,
        url,
        status: r.mock.status,
        path: folderPath(ws, r),
        enabled: r.mock.enabled,
        missing,
        problem: problemOf(url, missing),
      };
    });
  const liveCount = deriveActiveMocks(ws).length;
  const env = ws.environments[ws.activeEnvId];
  const web = isWebOrigin(tabOrigin);
  const siteActive = web && hasAccess && mockSites.includes(tabOrigin);
  return {
    rows: withShortUrls(rows),
    liveCount,
    idleCount: rows.filter(r => r.enabled).length - liveCount,
    envName: env && !env.deleted ? env.name : 'No environment',
    siteActive,
    showBanner: web && !siteActive && liveCount > 0,
  };
}

// Lowercase one character at a time, keeping any whose lowercase form is longer
// (like "İ"), so positions in the result match positions in the original.
// Final sigma folds to σ, as "Σ" alone would.
const fold = text => [...String(text ?? '')].map(c => { const l = c.toLowerCase(); return l.length === c.length ? (l === 'ς' ? 'σ' : l) : c; }).join('');
const words = query => fold(query).split(/\s+/).filter(Boolean);

// Rows where every word of the query appears in the method, name, url or path.
export function filterRows(rows, query) {
  const terms = words(query);
  if (!terms.length) return rows;
  return rows.filter(r => {
    const text = fold(`${r.method} ${r.name} ${r.problem ?? r.url} ${r.path}`);
    return terms.every(t => text.includes(t));
  });
}

// The short url, or the full one when a search word is only visible there.
export function displayUrl(row, query) {
  const full = fold(row.url);
  const short = fold(row.shortUrl);
  return words(query).some(t => full.includes(t) && !short.includes(t)) ? row.url : row.shortUrl;
}

// Where the query's words appear in text, as sorted, merged [start, end) ranges.
export function matchRanges(text, query) {
  const lower = fold(text);
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
