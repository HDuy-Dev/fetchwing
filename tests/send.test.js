import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSend, executeSend, MAX_DISPLAY_BYTES } from '../src/lib/send.js';

const resolved = (over = {}) => ({
  method: 'POST',
  url: 'https://api.x.dev/users?page=1',
  headers: [['Accept', 'application/json'], ['Cookie', 'sid=1'], ['cookie', 'b=2']],
  body: { mode: 'none', raw: '', fields: [] },
  missing: [],
  ...over,
});

test('buildSend moves Cookie out of headers', () => {
  const s = buildSend(resolved());
  assert.equal(s.cookie, 'sid=1; b=2');
  assert.deepEqual(s.init.headers, [['Accept', 'application/json']]);
  assert.equal(s.init.method, 'POST');
  assert.equal(s.init.body, undefined);
  assert.equal(s.url, 'https://api.x.dev/users?page=1');
});

test('json, text, urlencoded and form bodies', () => {
  const json = buildSend(resolved({ headers: [], body: { mode: 'json', raw: '{"a":1}', fields: [] } }));
  assert.equal(json.init.body, '{"a":1}');
  assert.deepEqual(json.init.headers, [['Content-Type', 'application/json']]);

  const keepType = buildSend(resolved({ headers: [['content-type', 'application/vnd+json']], body: { mode: 'json', raw: '{}', fields: [] } }));
  assert.deepEqual(keepType.init.headers, [['content-type', 'application/vnd+json']]);

  const form = buildSend(resolved({ headers: [], body: { mode: 'urlencoded', raw: '', fields: [{ key: 'a', value: 'b c', enabled: true }, { key: 'x', value: 'y', enabled: false }] } }));
  assert.equal(form.init.body, 'a=b+c');
  assert.deepEqual(form.init.headers, [['Content-Type', 'application/x-www-form-urlencoded']]);

  const multi = buildSend(resolved({ headers: [], body: { mode: 'formdata', raw: '', fields: [{ key: 'n', value: 'v', enabled: true }] } }));
  assert.ok(multi.init.body instanceof FormData);
  assert.equal(multi.init.body.get('n'), 'v');
  assert.deepEqual(multi.init.headers, []);

  const text = buildSend(resolved({ headers: [], body: { mode: 'text', raw: 'hi', fields: [] } }));
  assert.equal(text.init.body, 'hi');

  const get = buildSend(resolved({ method: 'GET', headers: [], body: { mode: 'json', raw: '{}', fields: [] } }));
  assert.equal(get.init.body, undefined, 'GET/HEAD never carry a body');
});

function fakeDnr() {
  const log = [];
  return {
    log,
    updateSessionRules: async ({ addRules = [], removeRuleIds = [] }) => {
      if (addRules.length) log.push(['add', addRules]);
      if (removeRuleIds.length) log.push(['remove', removeRuleIds]);
    },
  };
}

test('cookie becomes a session rule and is removed', async () => {
  const dnr = fakeDnr();
  let seen;
  const fetchFn = async (url, init) => { seen = { url, init }; return new Response('{"ok":1}', { status: 201, statusText: 'Created', headers: { 'x-a': '1' } }); };
  let t = 1000;
  const res = await executeSend({ resolved: resolved(), fetchFn, dnr, now: () => (t += 25), ruleId: 7 });
  assert.equal(seen.url, 'https://api.x.dev/users?page=1');
  assert.equal(dnr.log[0][0], 'add');
  assert.deepEqual(dnr.log[0][1], [{
    id: 7, priority: 1,
    action: { type: 'modifyHeaders', requestHeaders: [{ header: 'cookie', operation: 'set', value: 'sid=1; b=2' }] },
    condition: { urlFilter: '|https://api.x.dev/users?page=1|', resourceTypes: ['xmlhttprequest', 'other'] },
  }]);
  assert.deepEqual(dnr.log[1], ['remove', [7]]);
  assert.equal(res.status, 201);
  assert.equal(res.statusText, 'Created');
  assert.ok(res.headers.some(([k, v]) => k === 'x-a' && v === '1'));
  assert.equal(res.bodyText, '{"ok":1}');

  const failing = fakeDnr();
  await assert.rejects(executeSend({ resolved: resolved(), fetchFn: async () => { throw new TypeError('Failed to fetch'); }, dnr: failing, now: () => 0, ruleId: 9 }));
  assert.deepEqual(failing.log.at(-1), ['remove', [9]]);
});

test('no cookie means no rule', async () => {
  const dnr = fakeDnr();
  await executeSend({ resolved: resolved({ headers: [] }), fetchFn: async () => new Response(''), dnr, now: () => 0, ruleId: 1 });
  assert.deepEqual(dnr.log, []);
});

test('reports time, size and truncation', async () => {
  const big = 'x'.repeat(MAX_DISPLAY_BYTES + 10);
  let t = 0;
  const res = await executeSend({ resolved: resolved({ headers: [] }), fetchFn: async () => new Response(big), dnr: fakeDnr(), now: () => (t += 100), ruleId: 1 });
  assert.equal(res.timeMs, 100);
  assert.equal(res.sizeBytes, MAX_DISPLAY_BYTES + 10);
  assert.equal(res.bodyTruncated, true);
  assert.equal(res.bodyText.length, MAX_DISPLAY_BYTES);
});
