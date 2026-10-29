// Page-side mock runtime: replaces window.fetch and XMLHttpRequest so that
// requests matching an enabled mock get the configured response.
// No imports: src/content/mock-main.js is generated from this file
// (`npm run sync`) and runs in the page's own JavaScript world.

const NULL_BODY_STATUS = [101, 103, 204, 205, 304];
const STATUS_TEXT = {
  200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content', 301: 'Moved Permanently', 302: 'Found',
  304: 'Not Modified', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found',
  405: 'Method Not Allowed', 409: 'Conflict', 422: 'Unprocessable Entity', 429: 'Too Many Requests',
  500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout',
};

// Must produce exactly what matchKey() in src/lib/match.js produces.
export function runtimeKey(method, url) {
  let normalized = String(url ?? '').trim();
  try {
    const u = new URL(normalized);
    const params = [...u.searchParams.entries()].sort(([ak, av], [bk, bv]) =>
      ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0);
    const query = new URLSearchParams(params).toString();
    normalized = `${u.origin}${u.pathname}${query ? `?${query}` : ''}`;
  } catch {
    // keep as-is
  }
  return `${String(method).toUpperCase()} ${normalized}`;
}

export function installMockRuntime(win, { readyTimeoutMs = 300 } = {}) {
  if (win.__fetchwingRuntime) return win.__fetchwingRuntime;

  let mocks = null; // Map key -> mock, null until the first setMocks
  let markReady;
  const ready = new Promise(resolve => { markReady = resolve; });
  win.setTimeout(() => markReady(), readyTimeoutMs);

  const absolute = url => new win.URL(String(url), win.location.href).href;
  const lookupSync = (method, url) => (mocks ? mocks.get(runtimeKey(method, absolute(url))) ?? null : undefined);
  async function lookup(method, url) {
    if (!mocks) await ready;
    return mocks ? mocks.get(runtimeKey(method, absolute(url))) ?? null : null;
  }
  const responseHeaders = mock => [...mock.headers.map(h => [h.key, h.value]), ['x-fetchwing-mock', '1']];
  const abortError = () => new win.DOMException('The user aborted a request.', 'AbortError');

  function wait(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(abortError());
      const timer = win.setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => { win.clearTimeout(timer); reject(abortError()); }, { once: true });
    });
  }

  // ---- fetch ----
  const originalFetch = win.fetch;
  win.fetch = function fetch(input, init) {
    const args = arguments;
    const isRequest = typeof win.Request === 'function' && input instanceof win.Request;
    const url = isRequest ? input.url : input instanceof win.URL ? input.href : String(input);
    const method = (init?.method ?? (isRequest ? input.method : 'GET')).toUpperCase();
    const signal = init?.signal ?? (isRequest ? input.signal : undefined);
    const pass = () => originalFetch.apply(win, args);
    const known = lookupSync(method, url);
    if (known === null) return pass();
    return (async () => {
      const mock = known ?? (await lookup(method, url));
      if (!mock) return pass();
      await wait(mock.delayMs || 0, signal);
      const body = NULL_BODY_STATUS.includes(mock.status) ? null : mock.body;
      const res = new win.Response(body, {
        status: mock.status,
        statusText: STATUS_TEXT[mock.status] ?? '',
        headers: responseHeaders(mock),
      });
      Object.defineProperty(res, 'url', { value: absolute(url) });
      return res;
    })();
  };

  // ---- XMLHttpRequest ----
  const OriginalXHR = win.XMLHttpRequest;
  if (OriginalXHR) {
    class FetchwingXHR extends OriginalXHR {
      open(method, url, async = true, ...rest) {
        this.__fw = { method: String(method).toUpperCase(), url: String(url), async: async !== false, timers: [] };
        return super.open(method, url, async, ...rest);
      }

      send(body) {
        const info = this.__fw;
        if (!info) return super.send(body);
        const known = lookupSync(info.method, info.url);
        if (known === null || (known === undefined && !info.async)) return super.send(body);
        if (known) return this.__fwRespond(known);
        lookup(info.method, info.url).then(mock => (mock ? this.__fwRespond(mock) : super.send(body)));
      }

      abort() {
        if (this.__fw?.mocked) {
          this.__fw.timers.forEach(t => win.clearTimeout(t));
          this.__fwSet({ readyState: 4, status: 0 });
          this.dispatchEvent(new win.Event('readystatechange'));
          this.dispatchEvent(new win.ProgressEvent('abort'));
          this.dispatchEvent(new win.ProgressEvent('loadend'));
          this.__fwSet({ readyState: 0 });
          return;
        }
        return super.abort();
      }

      __fwSet(values) {
        for (const [name, value] of Object.entries(values)) {
          Object.defineProperty(this, name, { value, configurable: true, writable: false });
        }
      }

      __fwRespond(mock) {
        const info = this.__fw;
        info.mocked = true;
        const headers = responseHeaders(mock);
        const text = NULL_BODY_STATUS.includes(mock.status) ? '' : mock.body;
        const headerMap = new Map(headers.map(([k, v]) => [k.toLowerCase(), v]));
        Object.defineProperty(this, 'getResponseHeader', { value: name => headerMap.get(String(name).toLowerCase()) ?? null, configurable: true });
        Object.defineProperty(this, 'getAllResponseHeaders', {
          value: () => headers.map(([k, v]) => `${k.toLowerCase()}: ${v}\r\n`).join(''),
          configurable: true,
        });
        const fire = type => this.dispatchEvent(type === 'readystatechange' ? new win.Event(type) : new win.ProgressEvent(type));
        const step = (fn, ms) => info.timers.push(win.setTimeout(fn, ms));

        fire('loadstart');
        step(() => {
          this.__fwSet({ readyState: 2, status: mock.status, statusText: STATUS_TEXT[mock.status] ?? '', responseURL: absolute(info.url) });
          fire('readystatechange');
          this.__fwSet({ readyState: 3 });
          fire('readystatechange');
          let response = text;
          if (this.responseType === 'json') {
            try { response = text ? JSON.parse(text) : null; } catch { response = null; }
          }
          this.__fwSet({ readyState: 4, responseText: text, response });
          fire('readystatechange');
          fire('load');
          fire('loadend');
        }, mock.delayMs || 0);
      }
    }
    win.XMLHttpRequest = FetchwingXHR;
  }

  const runtime = {
    setMocks(list) {
      mocks = new Map((list || []).map(m => [m.key, m]));
      markReady();
    },
  };
  win.__fetchwingRuntime = runtime;
  return runtime;
}
