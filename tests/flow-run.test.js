import test from 'node:test';
import assert from 'node:assert/strict';
import { newRequest } from '../src/lib/model.js';
import { runFlow, mockResult } from '../src/lib/flow-run.js';

const req = (id, fields) => ({ id, type: 'request', parentId: null, order: 0, name: id, updatedAt: 0, deleted: false, ...newRequest(fields) });
const block = (id, requestId, outputs = []) => ({ id, kind: 'request', requestId, x: 0, y: 0, outputs });
const json = (status, body) => ({ status, statusText: '', timeMs: 1, sizeBytes: 1, headers: [['content-type', 'application/json']], bodyText: JSON.stringify(body), bodyTruncated: false });
const out = (name, path = `body.${name}`) => ({ name, path });

// A fake send: records calls and answers from a table of responses (or a function).
function fakeSend(table) {
  const calls = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const send = async args => {
    calls.push(args);
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      const answer = table[args.blockId];
      const r = typeof answer === 'function' ? await answer(args) : answer;
      await Promise.resolve();
      return r ?? { ok: true, response: json(200, {}) };
    } finally {
      inFlight--;
    }
  };
  return { send, calls, max: () => maxInFlight };
}

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

const base = extra => ({ envVars: {}, now: () => 0, sleep: async () => {}, runId: 'R', ...extra });

// a → (b, c) → d
function diamond(outputs = {}) {
  return {
    flow: {
      blocks: [block('a', 'ra', outputs.a), block('b', 'rb', outputs.b), block('c', 'rc', outputs.c), block('d', 'rd', outputs.d)],
      edges: [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }, { from: 'b', to: 'd' }, { from: 'c', to: 'd' }],
    },
    ws: { items: { ra: req('ra'), rb: req('rb'), rc: req('rc'), rd: req('rd') } },
  };
}

test('login → user passes the token and resolves sent.url', async () => {
  const ws = {
    items: {
      login: req('login', { method: 'POST', url: '{{base}}/login' }),
      user: req('user', { url: '{{base}}/me?t={{token}}', headers: [{ key: 'Authorization', value: 'Bearer {{token}}', enabled: true }] }),
    },
  };
  const flow = { blocks: [block('L', 'login', [out('token')]), block('U', 'user')], edges: [{ from: 'L', to: 'U' }] };
  const f = fakeSend({ L: { ok: true, response: json(200, { token: 'abc' }) } });
  const updates = [];
  const result = await runFlow(base({ flow, ws, envVars: { base: 'http://h' }, send: f.send, onUpdate: (id, r) => updates.push([id, r.state]) }));
  assert.equal(result.stopped, false);
  assert.deepEqual(f.calls.map(c => c.blockId), ['L', 'U']);
  assert.deepEqual(f.calls[1].vars, { token: 'abc' });
  assert.equal(f.calls[1].requestId, 'user');
  assert.equal(result.blocks.U.state, 'ok');
  assert.equal(result.blocks.U.sent.url, 'http://h/me?t=abc');
  assert.deepEqual(result.blocks.U.sent.headers, [['Authorization', 'Bearer abc']]);
  assert.deepEqual(result.blocks.L.outputs, { token: 'abc' });
  assert.ok(result.blocks.L.fingerprint);
  assert.deepEqual(updates.filter(([id]) => id === 'U').map(([, s]) => s), ['queued', 'running', 'ok']);
});

test('b and c run in parallel, d starts after both', async () => {
  const { flow, ws } = diamond();
  const db = deferred();
  const dc = deferred();
  const order = [];
  const f = fakeSend({
    b: async () => { order.push('b+'); await db.promise; order.push('b-'); },
    c: async () => { order.push('c+'); await dc.promise; order.push('c-'); },
    d: async () => { order.push('d+'); },
  });
  const running = runFlow(base({ flow, ws, send: f.send }));
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.deepEqual(order, ['b+', 'c+']);
  db.resolve();
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.ok(!order.includes('d+'));
  dc.resolve();
  const result = await running;
  assert.deepEqual(order, ['b+', 'c+', 'b-', 'c-', 'd+']);
  assert.equal(result.blocks.d.state, 'ok');
});

test('a 500 fails its block with kind http and skips downstream; siblings still run', async () => {
  const { flow, ws } = diamond();
  const f = fakeSend({ b: { ok: true, response: json(500, { e: 1 }) } });
  const result = await runFlow(base({ flow, ws, send: f.send }));
  assert.equal(result.blocks.b.state, 'failed');
  assert.equal(result.blocks.b.errorKind, 'http');
  assert.equal(result.blocks.b.response.status, 500);
  assert.equal(result.blocks.c.state, 'ok');
  assert.equal(result.blocks.d.state, 'skipped');
  assert.ok(!f.calls.some(c => c.blockId === 'd'));
});

test('send failure is network, or cancelled when it says so', async () => {
  const { flow, ws } = diamond();
  const f = fakeSend({ b: { ok: false, error: 'boom' }, c: { ok: false, error: 'stop', cancelled: true } });
  const result = await runFlow(base({ flow, ws, send: f.send }));
  assert.equal(result.blocks.b.errorKind, 'network');
  assert.equal(result.blocks.b.error, 'boom');
  assert.equal(result.blocks.c.errorKind, 'cancelled');
  assert.equal(result.blocks.d.state, 'skipped');
});

test('an enabled mock answers without send and its outputs are read', async () => {
  const { flow, ws } = diamond({ b: [out('id')] });
  ws.items.rb.mock = { enabled: true, status: 201, headers: [], body: '{"id":7}', delayMs: 40 };
  ws.items.rd = req('rd', { url: '/x/{{id}}' });
  const slept = [];
  const f = fakeSend({});
  const result = await runFlow(base({ flow, ws, send: f.send, sleep: async ms => { slept.push(ms); } }));
  assert.ok(!f.calls.some(c => c.blockId === 'b'));
  assert.deepEqual(slept, [40]);
  assert.equal(result.blocks.b.mock, true);
  assert.equal(result.blocks.b.state, 'ok');
  assert.deepEqual(result.blocks.b.outputs, { id: 7 });
  assert.deepEqual(f.calls.find(c => c.blockId === 'd').vars, { id: 7 });
  assert.equal(result.blocks.d.sent.url, '/x/7');
});

test('mockResult has the executeSend shape and defaults a JSON content-type', () => {
  const r = mockResult({ enabled: true, status: 200, headers: [], body: '{"a":"é"}', delayMs: 5 });
  assert.deepEqual(r, {
    status: 200, statusText: '', timeMs: 5, sizeBytes: 10,
    headers: [['content-type', 'application/json']], bodyText: '{"a":"é"}', bodyTruncated: false,
  });
  const t = mockResult({ enabled: true, status: 404, headers: [{ key: 'X', value: '1' }, { key: 'Y', value: '2', enabled: false }], body: 'nope', delayMs: 0 });
  assert.deepEqual(t.headers, [['X', '1']]);
  assert.deepEqual(mockResult({ enabled: true, status: 200, headers: [], body: 'plain', delayMs: 0 }).headers, []);
});

test('the same request in two blocks gets distinct keys', async () => {
  const ws = { items: { r: req('r') } };
  const flow = { blocks: [block('x', 'r'), block('y', 'r')], edges: [] };
  const f = fakeSend({});
  await runFlow(base({ flow, ws, send: f.send }));
  assert.deepEqual(f.calls.map(c => c.key).sort(), ['R:x', 'R:y']);
});

test('an output past a truncated body fails with kind truncated', async () => {
  const ws = { items: { r: req('r') } };
  const flow = { blocks: [block('x', 'r', [out('deep', 'body.a.b')])], edges: [] };
  const f = fakeSend({ x: { ok: true, response: { ...json(200, {}), bodyText: '{"a":', bodyTruncated: true } } });
  const result = await runFlow(base({ flow, ws, send: f.send }));
  assert.equal(result.blocks.x.state, 'failed');
  assert.equal(result.blocks.x.errorKind, 'truncated');
});

test('a variable with no source is missing, never sent, downstream skipped', async () => {
  const ws = { items: { r: req('r', { url: '/{{x}}' }), s: req('s') } };
  const flow = { blocks: [block('m', 'r'), block('n', 's')], edges: [{ from: 'm', to: 'n' }] };
  const f = fakeSend({});
  const result = await runFlow(base({ flow, ws, send: f.send }));
  assert.equal(result.blocks.m.state, 'missing');
  assert.equal(result.blocks.m.errorKind, 'missing');
  assert.equal(result.blocks.n.state, 'skipped');
  assert.equal(f.calls.length, 0);
});

test('an output not found at run time leaves the downstream block missing', async () => {
  const ws = { items: { r: req('r'), s: req('s', { url: '/{{id}}' }), t: req('t') } };
  const flow = { blocks: [block('p', 'r', [out('id')]), block('q', 's'), block('z', 't')], edges: [{ from: 'p', to: 'q' }, { from: 'q', to: 'z' }] };
  const f = fakeSend({ p: { ok: true, response: json(200, { other: 1 }) } });
  const result = await runFlow(base({ flow, ws, send: f.send }));
  assert.equal(result.blocks.p.state, 'ok');
  assert.deepEqual(result.blocks.p.outputs, {});
  assert.equal(result.blocks.q.state, 'missing');
  assert.equal(result.blocks.q.errorKind, 'missing');
  assert.equal(result.blocks.z.state, 'skipped');
  assert.deepEqual(f.calls.map(c => c.blockId), ['p']);
});

test('conflict ends missing, deleted ends failed, both skip downstream', async () => {
  const ws = { items: { r: req('r'), u: req('u', { url: '/{{id}}' }), v: req('v') } };
  const flow = {
    blocks: [block('A', 'r', [out('id')]), block('B', 'r', [out('id')]), block('C', 'u'), block('D', 'gone'), block('E', 'v'), block('F', 'v')],
    edges: [{ from: 'A', to: 'C' }, { from: 'B', to: 'C' }, { from: 'C', to: 'E' }, { from: 'D', to: 'F' }],
  };
  const f = fakeSend({});
  const result = await runFlow(base({ flow, ws, send: f.send }));
  assert.equal(result.blocks.C.state, 'missing');
  assert.equal(result.blocks.C.errorKind, 'conflict');
  assert.equal(result.blocks.D.state, 'failed');
  assert.equal(result.blocks.D.errorKind, 'deleted');
  assert.equal(result.blocks.E.state, 'skipped');
  assert.equal(result.blocks.F.state, 'skipped');
  assert.deepEqual(f.calls.map(c => c.blockId).sort(), ['A', 'B']);
});

test('aborting while b is in flight stops the run', async () => {
  const { flow, ws } = diamond();
  const ctrl = new AbortController();
  const db = deferred();
  const f = fakeSend({ b: async () => { await db.promise; return { ok: false, error: 'aborted', cancelled: true }; } });
  const running = runFlow(base({ flow, ws, send: f.send, signal: ctrl.signal }));
  for (let i = 0; i < 20; i++) await Promise.resolve();
  ctrl.abort();
  const result = await running;
  db.resolve();
  assert.equal(result.stopped, true);
  assert.equal(result.blocks.b.state, 'failed');
  assert.equal(result.blocks.b.errorKind, 'cancelled');
  assert.equal(result.blocks.c.state, 'ok');
  assert.equal(result.blocks.d.state, 'idle');
  assert.ok(f.calls.every(c => c.signal === ctrl.signal));
});

test('concurrency 1 keeps one send in flight', async () => {
  const ws = { items: { r: req('r') } };
  const flow = { blocks: ['p', 'q', 's', 't'].map(id => block(id, 'r')), edges: [] };
  const f = fakeSend({});
  const result = await runFlow(base({ flow, ws, send: f.send, concurrency: 1 }));
  assert.equal(f.calls.length, 4);
  assert.equal(f.max(), 1);
  assert.ok(Object.values(result.blocks).every(b => b.state === 'ok'));
});

test('times are relative to the run start', async () => {
  const ws = { items: { r: req('r') } };
  const flow = { blocks: [block('x', 'r')], edges: [] };
  let t = 1000;
  const f = fakeSend({ x: async () => { t += 25; } });
  const result = await runFlow(base({ flow, ws, send: f.send, now: () => t }));
  assert.equal(result.blocks.x.startMs, 0);
  assert.equal(result.blocks.x.endMs, 25);
  assert.equal(result.totalMs, 25);
});

test('run from c reuses previous results upstream', async () => {
  const { flow, ws } = diamond({ a: [out('aid')], c: [out('cid')] });
  ws.items.rd = req('rd', { url: '/{{aid}}/{{cid}}' });
  const previous = {
    blocks: {
      a: { state: 'ok', outputs: { aid: 'A1' } },
      b: { state: 'ok', outputs: {} },
      c: { state: 'ok', outputs: { cid: 'old' } },
      d: { state: 'ok', outputs: {} },
    },
  };
  const f = fakeSend({ c: { ok: true, response: json(200, { cid: 'C2' }) } });
  const result = await runFlow(base({ flow, ws, send: f.send, from: 'c', previous }));
  assert.deepEqual(f.calls.map(c => c.blockId), ['c', 'd']);
  assert.deepEqual(f.calls[1].vars, { aid: 'A1', cid: 'C2' });
  assert.equal(result.blocks.d.sent.url, '/A1/C2');
  assert.deepEqual(result.blocks.a, previous.blocks.a);
});
