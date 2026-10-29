// Sending a request from the extension. fetch() may not set the Cookie
// header, so a cookie from the cURL command travels via a temporary
// declarativeNetRequest session rule for exactly that URL.

export const MAX_DISPLAY_BYTES = 2 * 1024 * 1024;

const hasHeader = (headers, name) => headers.some(([k]) => k.toLowerCase() === name);

export function buildSend(resolved) {
  const cookies = [];
  const headers = [];
  for (const [k, v] of resolved.headers) {
    if (k.toLowerCase() === 'cookie') cookies.push(v);
    else headers.push([k, v]);
  }

  let body;
  const { mode, raw, fields } = resolved.body;
  const enabled = fields.filter(f => f.enabled && f.key);
  if (mode === 'json' || mode === 'text') {
    body = raw;
    if (mode === 'json' && !hasHeader(headers, 'content-type')) headers.push(['Content-Type', 'application/json']);
  } else if (mode === 'urlencoded') {
    body = new URLSearchParams(enabled.map(f => [f.key, f.value])).toString();
    if (!hasHeader(headers, 'content-type')) headers.push(['Content-Type', 'application/x-www-form-urlencoded']);
  } else if (mode === 'formdata') {
    body = new FormData();
    for (const f of enabled) body.append(f.key, f.value);
  }
  if (resolved.method === 'GET' || resolved.method === 'HEAD') body = undefined;

  return {
    url: resolved.url,
    init: { method: resolved.method, headers, body, credentials: 'omit', redirect: 'follow' },
    cookie: cookies.length ? cookies.join('; ') : null,
  };
}

export async function executeSend({ resolved, fetchFn, dnr, now, ruleId, signal }) {
  const { url, init, cookie } = buildSend(resolved);
  if (cookie) {
    await dnr.updateSessionRules({
      addRules: [{
        id: ruleId,
        priority: 1,
        action: { type: 'modifyHeaders', requestHeaders: [{ header: 'cookie', operation: 'set', value: cookie }] },
        condition: { urlFilter: `|${url}|`, resourceTypes: ['xmlhttprequest', 'other'] },
      }],
    });
  }
  try {
    const started = now();
    const res = await fetchFn(url, signal ? { ...init, signal } : init);
    const text = await res.text();
    const timeMs = now() - started;
    return {
      status: res.status,
      statusText: res.statusText,
      timeMs,
      sizeBytes: new TextEncoder().encode(text).length,
      headers: [...res.headers.entries()],
      bodyText: text.length > MAX_DISPLAY_BYTES ? text.slice(0, MAX_DISPLAY_BYTES) : text,
      bodyTruncated: text.length > MAX_DISPLAY_BYTES,
    };
  } finally {
    if (cookie) await dnr.updateSessionRules({ removeRuleIds: [ruleId] });
  }
}
