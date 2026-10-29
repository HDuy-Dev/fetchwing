import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installMockRuntime, runtimeKey } from '../src/lib/mock-runtime.js';
import { matchKey } from '../src/lib/match.js';
import { buildMockMain } from '../scripts/sync-mock-main.mjs';

const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

// Minimal stand-in for the browser XMLHttpRequest: read-only state on the
// prototype, on<event> handlers called from dispatchEvent.
class FakeXHR extends EventTarget {
  static sent = [];
  constructor() { super(); this._state = 0; this._headers = {}; this.responseType = ''; }
  get readyState() { return this._state; }
  get status() { return this._status ?? 0; }
  get statusText() { return ''; }
  get responseText() { return this._text ?? ''; }
  get response() { return this._text ?? ''; }
  get responseURL() { return this._url ?? ''; }
  getResponseHeader() { return null; }
  getAllResponseHeaders() { return ''; }
  open(method, url) { this._method = method; this._url = url; this._state = 1; }
  setRequestHeader(k, v) { this._headers[k] = v; }
  send(body) {
    FakeXHR.sent.push({ method: this._method, url: this._url, body, headers: this._headers });
    setTimeout(() => { this._state = 4; this._status = 200; this._text = 'real'; this.dispatchEvent(new Event('readystatechange')); this.dispatchEvent(new Event('load')); });
  }
  abort() {}
  dispatchEvent(e) {
    const handler = this[`on${e.type}`];
    const result = super.dispatchEvent(e);
    if (typeof handler === 'function') handler.call(this, e);
    return result;
  }
}

function fakeWindow() {
  const calls = [];
  const win = {
    location: { href: 'http://localhost:3000/app' },
    fetch: async (...args) => { calls.push(args); return new Response('real', { status: 200 }); },
    XMLHttpRequest: FakeXHR,
    Response, Request, Headers, URL, Event, DOMException,
    ProgressEvent: Event,
    setTimeout, clearTimeout,
  };
  return { win, calls };
}

const MOCK = {
  key: matchKey('GET', 'http://localhost:3000/api/users?page=2&size=10'),
  method: 'GET', url: 'http://localhost:3000/api/users?page=2&size=10',
  status: 201, headers: [{ key: 'content-type', value: 'application/json' }, { key: 'x-a', value: '1' }],
  body: '{"users":["mocked"]}', delayMs: 0, requestId: 'r', name: 'Users',
};

test('runtime keys agree with matchKey', () => {
  for (const [m, u] of [['get', 'http://LocalHost:3000/a?b=2&a=1'], ['POST', 'https://x.dev:443/p?x=1#f'], ['GET', 'https://x.dev/a?q=a%20b&q=c']]) {
    assert.equal(runtimeKey(m, u), matchKey(m, u));
  }
});

test('fetch returns mock when matching (relative URL, query order ignored)', async () => {
  const { win, calls } = fakeWindow();
  const rt = installMockRuntime(win);
  rt.setMocks([MOCK]);
  const res = await win.fetch('/api/users?size=10&page=2');
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { users: ['mocked'] });
  assert.equal(res.headers.get('x-a'), '1');
  assert.equal(res.headers.get('x-fetchwing-mock'), '1');
  assert.equal(res.url, 'http://localhost:3000/api/users?size=10&page=2');
  assert.equal(calls.length, 0);
});

test('passes through non-matching requests with identical args', async () => {
  const { win, calls } = fakeWindow();
  const rt = installMockRuntime(win);
  rt.setMocks([MOCK]);
  const init = { method: 'POST', body: 'x' };
  await win.fetch('/api/users?page=2&size=10', init);
  const req = new Request('http://localhost:3000/other');
  await win.fetch(req);
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], '/api/users?page=2&size=10');
  assert.equal(calls[0][1], init);
  assert.equal(calls[1][0], req);
});

test('Request objects can be mocked', async () => {
  const { win } = fakeWindow();
  const rt = installMockRuntime(win);
  rt.setMocks([MOCK]);
  const res = await win.fetch(new Request('http://localhost:3000/api/users?page=2&size=10'));
  assert.equal(res.status, 201);
});

test('waits for mocks before deciding', async () => {
  const { win, calls } = fakeWindow();
  const rt = installMockRuntime(win, { readyTimeoutMs: 1000 });
  const pending = win.fetch('/api/users?page=2&size=10');
  await tick(5);
  rt.setMocks([MOCK]);
  assert.equal((await pending).status, 201);
  assert.equal(calls.length, 0);
});

test('times out to pass through when no mocks arrive', async () => {
  const { win, calls } = fakeWindow();
  installMockRuntime(win, { readyTimeoutMs: 10 });
  const res = await win.fetch('/api/users?page=2&size=10');
  assert.equal(await res.text(), 'real');
  assert.equal(calls.length, 1);
});

test('applies delay and supports null-body statuses', async () => {
  const { win } = fakeWindow();
  const rt = installMockRuntime(win);
  rt.setMocks([{ ...MOCK, delayMs: 40 }, { ...MOCK, key: matchKey('DELETE', 'http://localhost:3000/x'), method: 'DELETE', status: 204, body: 'ignored' }]);
  const t0 = Date.now();
  await win.fetch('/api/users?page=2&size=10');
  assert.ok(Date.now() - t0 >= 35);
  const res = await win.fetch('/x', { method: 'DELETE' });
  assert.equal(res.status, 204);
  assert.equal(await res.text(), '');
});

test('abort rejects', async () => {
  const { win } = fakeWindow();
  const rt = installMockRuntime(win);
  rt.setMocks([{ ...MOCK, delayMs: 200 }]);
  const ctrl = new AbortController();
  const p = win.fetch('/api/users?page=2&size=10', { signal: ctrl.signal });
  ctrl.abort();
  await assert.rejects(p, err => err.name === 'AbortError');
});

test('mocked XHR behaves like real one', async () => {
  const { win } = fakeWindow();
  const rt = installMockRuntime(win);
  rt.setMocks([MOCK]);
  const xhr = new win.XMLHttpRequest();
  const events = [];
  xhr.onreadystatechange = () => events.push(`rs${xhr.readyState}`);
  xhr.addEventListener('loadstart', () => events.push('loadstart'));
  xhr.onload = () => events.push('load');
  xhr.addEventListener('loadend', () => events.push('loadend'));
  xhr.open('GET', '/api/users?size=10&page=2');
  xhr.responseType = 'json';
  const done = new Promise(r => xhr.addEventListener('loadend', r));
  xhr.send();
  await done;
  assert.equal(xhr.readyState, 4);
  assert.equal(xhr.status, 201);
  assert.equal(xhr.statusText, 'Created');
  assert.deepEqual(xhr.response, { users: ['mocked'] });
  assert.equal(xhr.responseText, '{"users":["mocked"]}');
  assert.equal(xhr.responseURL, 'http://localhost:3000/api/users?size=10&page=2');
  assert.equal(xhr.getResponseHeader('X-A'), '1');
  assert.match(xhr.getAllResponseHeaders(), /x-fetchwing-mock: 1\r\n/);
  assert.deepEqual(events, ['loadstart', 'rs2', 'rs3', 'rs4', 'load', 'loadend']);
  assert.equal(FakeXHR.sent.length, 0);
});

test('XHR passes through non-matching', async () => {
  FakeXHR.sent = [];
  const { win } = fakeWindow();
  const rt = installMockRuntime(win);
  rt.setMocks([MOCK]);
  const xhr = new win.XMLHttpRequest();
  xhr.open('POST', '/api/save');
  xhr.setRequestHeader('x-k', 'v');
  const loaded = new Promise(r => { xhr.onload = r; });
  xhr.send('body');
  await loaded;
  assert.equal(xhr.responseText, 'real');
  assert.deepEqual(FakeXHR.sent, [{ method: 'POST', url: '/api/save', body: 'body', headers: { 'x-k': 'v' } }]);
});

test('installing twice is a no-op', () => {
  const { win } = fakeWindow();
  installMockRuntime(win);
  const patched = win.fetch;
  installMockRuntime(win);
  assert.equal(win.fetch, patched);
});

test('mock-main is in sync', () => {
  const main = readFileSync(new URL('../src/content/mock-main.js', import.meta.url), 'utf8');
  const runtime = readFileSync(new URL('../src/lib/mock-runtime.js', import.meta.url), 'utf8');
  assert.equal(main, buildMockMain(runtime), 'run `npm run sync`');
});
