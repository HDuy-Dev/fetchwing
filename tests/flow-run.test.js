import test from 'node:test';
import assert from 'node:assert/strict';
import { newRequest } from '../src/lib/model.js';
import { runFlow, mockResult } from '../src/lib/flow-run.js';
import { runLogic as runtimeLogic } from '../src/lib/script-runtime.js';

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
  assert.equal(result.blocks.x.error, 'Response too large to read output `deep`');
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

test('a send that resolves ok without a response fails as network and the run ends', async () => {
  const { flow, ws } = diamond();
  const f = fakeSend({ b: async () => ({ ok: true }) });
  const result = await runFlow(base({ flow, ws, send: f.send }));
  assert.equal(result.blocks.b.state, 'failed');
  assert.equal(result.blocks.b.errorKind, 'network');
  assert.ok(result.blocks.b.error);
  assert.equal(result.blocks.d.state, 'skipped');
});

test('a rejected send or a throwing onUpdate never leaves a block running', async t => {
  t.mock.method(console, 'error', () => {});
  const { flow, ws } = diamond();
  const send = async ({ blockId }) => {
    if (blockId === 'b') throw new Error('kaput');
    return { ok: true, response: json(200, {}) };
  };
  const result = await runFlow(base({ flow, ws, send, onUpdate: () => { throw new Error('listener'); } }));
  assert.equal(result.blocks.b.errorKind, 'network');
  assert.equal(result.blocks.b.error, 'kaput');
  assert.equal(result.blocks.c.state, 'ok');
  assert.equal(result.blocks.d.state, 'skipped');
  assert.ok(Object.values(result.blocks).every(b => b.state !== 'running'));
});

test('an abort from inside onUpdate stops further sends', async () => {
  const ws = { items: { r: req('r') } };
  const flow = { blocks: ['p', 'q', 's'].map(id => block(id, 'r')), edges: [] };
  const ctrl = new AbortController();
  const f = fakeSend({});
  const onUpdate = (id, r) => { if (id === 'p' && r.state === 'running') ctrl.abort(); };
  const result = await runFlow(base({ flow, ws, send: f.send, signal: ctrl.signal, onUpdate }));
  assert.equal(result.stopped, true);
  assert.equal(f.calls.length, 0);
  assert.equal(result.blocks.p.errorKind, 'cancelled');
  assert.equal(result.blocks.q.state, 'idle');
  assert.equal(result.blocks.s.state, 'idle');
});

test('concurrency 0, negative or NaN behaves like 1', async () => {
  const ws = { items: { r: req('r') } };
  const flow = { blocks: ['p', 'q', 's'].map(id => block(id, 'r')), edges: [] };
  for (const concurrency of [0, -2, NaN]) {
    const f = fakeSend({});
    const result = await runFlow(base({ flow, ws, send: f.send, concurrency }));
    assert.equal(f.calls.length, 3);
    assert.equal(f.max(), 1);
    assert.ok(Object.values(result.blocks).every(b => b.state === 'ok'));
  }
});

test('a throw while starting a later block rejects the run instead of hanging', async () => {
  const { flow, ws } = diamond();
  ws.items.rb.headers = null; // resolveRequest throws when b starts, after a answered
  const f = fakeSend({});
  const settled = await Promise.race([
    runFlow({ ...base(), flow, ws, send: f.send }).then(() => 'resolved', e => `rejected: ${e instanceof TypeError}`),
    new Promise(r => setTimeout(() => r('hung'), 500)),
  ]);
  assert.equal(settled, 'rejected: true');
  assert.equal(f.calls[0].blockId, 'a');
});

test('a throwing onUpdate listener is logged, not fatal', async () => {
  const ws = { items: { r: req('r') } };
  const flow = { blocks: [block('x', 'r')], edges: [] };
  const f = fakeSend({ x: { ok: true, response: json(200, {}) } });
  const orig = console.error; const logged = [];
  console.error = (...a) => logged.push(a);
  try {
    const result = await runFlow(base({ flow, ws, send: f.send, onUpdate: () => { throw new Error('boom'); } }));
    assert.equal(result.blocks.x.state, 'ok');
  } finally { console.error = orig; }
  assert.equal(logged[0][0], 'Flow run listener failed');
});

const logic = (id, script, outputs = []) => ({ id, kind: 'logic', name: 'Logic', script, x: 0, y: 0, outputs: outputs.map(name => ({ name })) });
// Runs logic blocks with the real runtime (Node allows new Function) and records each call.
function realLogic() {
  const calls = [];
  const runLogic = async args => { calls.push(args); return runtimeLogic(args.script, { vars: args.vars, env: args.env }); };
  return { runLogic, calls };
}

test('A and B feed a logic block whose output feeds C', async () => {
  const ws = { items: { ra: req('ra'), rb: req('rb'), rc: req('rc', { url: 'http://h/o?t={{total}}' }) } };
  const flow = {
    blocks: [block('A', 'ra', [out('price')]), block('B', 'rb', [out('qty')]),
      logic('L', "console.log(typeof fw.vars.get('price')); return { total: fw.vars.get('price') * Number(fw.vars.get('qty')) }", ['total']),
      block('C', 'rc')],
    edges: [{ from: 'A', to: 'L' }, { from: 'B', to: 'L' }, { from: 'L', to: 'C' }],
  };
  const f = fakeSend({ A: { ok: true, response: json(200, { price: 2 }) }, B: { ok: true, response: json(200, { qty: '3' }) } });
  const lg = realLogic();
  const result = await runFlow(base({ flow, ws, envVars: { env1: 'e' }, send: f.send, runLogic: lg.runLogic }));
  assert.equal(result.blocks.L.state, 'ok');
  assert.deepEqual(result.blocks.L.outputs, { total: 6 });
  assert.equal(result.blocks.L.logs[0].text, 'number');
  assert.equal(result.blocks.L.logic, true);
  assert.ok(result.blocks.L.fingerprint);
  assert.deepEqual(lg.calls[0].vars, { price: 2, qty: '3', env1: 'e' });
  assert.deepEqual(lg.calls[0].env, { env1: 'e' });
  assert.equal(lg.calls[0].blockId, 'L');
  assert.deepEqual(f.calls.find(c => c.blockId === 'C').vars, { total: 6 });
  assert.equal(result.blocks.C.sent.url, 'http://h/o?t=6');
});

test('flow outputs win over env in fw.vars', async () => {
  const ws = { items: { ra: req('ra') } };
  const flow = { blocks: [block('A', 'ra', [out('k')]), logic('L', "return { v: fw.vars.get('k') }", ['v'])], edges: [{ from: 'A', to: 'L' }] };
  const f = fakeSend({ A: { ok: true, response: json(200, { k: 5 }) } });
  const lg = realLogic();
  const result = await runFlow(base({ flow, ws, envVars: { k: 'env' }, send: f.send, runLogic: lg.runLogic }));
  assert.deepEqual(result.blocks.L.outputs, { v: 5 });
});

test('a logic block with no parents runs first with hard-coded values', async () => {
  const ws = { items: { rc: req('rc', { url: 'http://h/{{id}}' }) } };
  const flow = { blocks: [logic('L', 'return { id: 42 }', ['id']), block('C', 'rc')], edges: [{ from: 'L', to: 'C' }] };
  const f = fakeSend({});
  const result = await runFlow(base({ flow, ws, send: f.send, runLogic: realLogic().runLogic }));
  assert.equal(result.blocks.L.state, 'ok');
  assert.equal(result.blocks.C.sent.url, 'http://h/42');
});

test('a throwing script fails the block with errorKind script and skips downstream', async () => {
  const ws = { items: { rc: req('rc') } };
  const flow = { blocks: [logic('L', "console.log('before'); throw new Error('boom')", ['x']), block('C', 'rc')], edges: [{ from: 'L', to: 'C' }] };
  const result = await runFlow(base({ flow, ws, send: fakeSend({}).send, runLogic: realLogic().runLogic }));
  assert.equal(result.blocks.L.state, 'failed');
  assert.equal(result.blocks.L.errorKind, 'script');
  assert.equal(result.blocks.L.error, 'Error: boom');
  assert.deepEqual(result.blocks.L.logs, [{ level: 'log', text: 'before' }]);
  assert.equal(result.blocks.C.state, 'skipped');
});

test('a timeout gives errorKind timeout', async () => {
  const flow = { blocks: [logic('L', '')], edges: [] };
  const runLogic = async () => ({ logs: [], error: 'Script timed out after 5 s', timedOut: true });
  const result = await runFlow(base({ flow, ws: { items: {} }, send: fakeSend({}).send, runLogic }));
  assert.equal(result.blocks.L.errorKind, 'timeout');
  assert.equal(result.blocks.L.error, 'Script timed out after 5 s');
});

test('returning a non-object with declared outputs fails', async () => {
  const flow = { blocks: [logic('L', 'return 3', ['a'])], edges: [] };
  const result = await runFlow(base({ flow, ws: { items: {} }, send: fakeSend({}).send, runLogic: realLogic().runLogic }));
  assert.equal(result.blocks.L.state, 'failed');
  assert.equal(result.blocks.L.errorKind, 'script');
  assert.equal(result.blocks.L.error, 'Script must return an object like { name: value }');
});

test('undeclared keys are warned, not output', async () => {
  const flow = { blocks: [logic('L', 'return { a: 1, b: 2 }', ['a'])], edges: [] };
  const result = await runFlow(base({ flow, ws: { items: {} }, send: fakeSend({}).send, runLogic: realLogic().runLogic }));
  assert.deepEqual(result.blocks.L.outputs, { a: 1 });
  assert.deepEqual(result.blocks.L.warnings, ['Returned `b` is not a declared output, so it was ignored']);
  assert.deepEqual(result.blocks.L.value, { a: 1, b: 2 });
});

test('conflicting upstream names are left out of fw.vars with a warning', async () => {
  const ws = { items: { ra: req('ra'), rb: req('rb') } };
  const flow = {
    blocks: [block('A', 'ra', [out('y')]), block('B', 'rb', [out('y')]), logic('L', 'return { all: fw.vars.toObject() }', ['all'])],
    edges: [{ from: 'A', to: 'L' }, { from: 'B', to: 'L' }],
  };
  const f = fakeSend({ A: { ok: true, response: json(200, { y: 1 }) }, B: { ok: true, response: json(200, { y: 2 }) } });
  const result = await runFlow(base({ flow, ws, send: f.send, runLogic: realLogic().runLogic }));
  assert.deepEqual(result.blocks.L.outputs, { all: {} });
  assert.deepEqual(result.blocks.L.warnings, ['`y` comes from more than one block, so fw.vars leaves it out']);
});

test('abort while a logic block runs marks it failed cancelled', async () => {
  const flow = { blocks: [logic('L', '')], edges: [] };
  const ctrl = new AbortController();
  const runLogic = ({ signal }) => new Promise(resolve => signal.addEventListener('abort', () => resolve({ logs: [], cancelled: true, error: 'Stopped' })));
  const running = runFlow(base({ flow, ws: { items: {} }, send: fakeSend({}).send, runLogic, signal: ctrl.signal }));
  for (let i = 0; i < 10; i++) await Promise.resolve();
  ctrl.abort();
  const result = await running;
  assert.equal(result.stopped, true);
  assert.equal(result.blocks.L.state, 'failed');
  assert.equal(result.blocks.L.errorKind, 'cancelled');
});

test('missing runLogic fails logic blocks with a clear error', async () => {
  const flow = { blocks: [logic('L', '')], edges: [] };
  const result = await runFlow(base({ flow, ws: { items: {} }, send: fakeSend({}).send }));
  assert.equal(result.blocks.L.state, 'failed');
  assert.equal(result.blocks.L.error, "Logic blocks can't run here");
});

test('a logic block missing a required var is not run', async () => {
  const flow = { blocks: [logic('L', "fw.vars.get('nope')")], edges: [] };
  const lg = realLogic();
  const result = await runFlow(base({ flow, ws: { items: {} }, send: fakeSend({}).send, runLogic: lg.runLogic }));
  assert.equal(result.blocks.L.state, 'missing');
  assert.equal(lg.calls.length, 0);
});

test('a logic block does not wait for a request concurrency slot', async () => {
  const ws = { items: { ra: req('ra') } };
  const flow = { blocks: [block('A', 'ra'), logic('L', 'return {}')], edges: [] };
  const da = deferred();
  const order = [];
  const f = fakeSend({ A: async () => { await da.promise; order.push('A'); return { ok: true, response: json(200, {}) }; } });
  const runLogic = async () => { order.push('L'); return { logs: [], value: {} }; };
  const running = runFlow(base({ flow, ws, send: f.send, runLogic, concurrency: 1 }));
  for (let i = 0; i < 20; i++) await Promise.resolve();
  da.resolve();
  const result = await running;
  assert.deepEqual(order, ['L', 'A']);
  assert.equal(result.blocks.L.state, 'ok');
});
