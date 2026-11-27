import test from 'node:test';
import assert from 'node:assert/strict';
import { newRequest } from '../src/lib/model.js';
import { createRunner, flowOrigins, ABANDONED_NOTE } from '../src/panel/flow-runner.js';

const req = (id, fields) => ({ id, type: 'request', parentId: null, order: 0, name: id, updatedAt: 0, deleted: false, ...newRequest(fields) });
const block = (id, requestId, outputs = []) => ({ id, kind: 'request', requestId, x: 0, y: 0, outputs });
const ok = body => ({ ok: true, response: { status: 200, statusText: '', timeMs: 1, sizeBytes: 1, headers: [['content-type', 'application/json']], bodyText: JSON.stringify(body), bodyTruncated: false } });
const tick = () => new Promise(r => setTimeout(r, 0));

function makeWs() {
  const items = {
    ra: req('ra', { url: '{{base}}/login' }),
    rb: req('rb', { url: 'https://two.test/u/{{t}}' }),
    rc: req('rc', { url: 'https://mocked.test/' }),
  };
  items.rc.mock = { ...items.rc.mock, enabled: true, status: 200, body: '{}', delayMs: 0 };
  const flow = { id: 'f', name: 'F', deleted: false, blocks: [block('a', 'ra', [{ name: 't', path: 'body.t' }]), block('b', 'rb'), block('c', 'rc')], edges: [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }] };
  return { items, flows: { f: flow }, activeEnvId: 'e', environments: { e: { id: 'e', name: 'E', vars: [{ key: 'base', value: 'https://one.test' }] } } };
}

// Two pages share one store; each page gets its own onChanged listeners.
function sharedStore() {
  const data = {};
  const pages = [];
  return {
    data,
    page() {
      const listeners = new Set();
      pages.push(listeners);
      return {
        async get(keys) {
          if (keys == null) return structuredClone(data);
          const list = typeof keys === 'string' ? [keys] : keys;
          return Object.fromEntries(list.filter(k => k in data).map(k => [k, structuredClone(data[k])]));
        },
        async set(values) {
          const changes = {};
          for (const [k, v] of Object.entries(values)) {
            changes[k] = { newValue: structuredClone(v) };
            data[k] = structuredClone(v);
          }
          setTimeout(() => pages.forEach(ls => ls.forEach(fn => fn(structuredClone(changes)))));
        },
        onChanged: { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) },
      };
    },
  };
}

function fakeTimers() {
  const intervals = new Map();
  let id = 0;
  return {
    setInterval: (fn) => { intervals.set(++id, fn); return id; },
    clearInterval: i => intervals.delete(i),
    fire: () => [...intervals.values()].forEach(fn => fn()),
    count: () => intervals.size,
  };
}

function controlledSend() {
  const calls = [];
  const pending = new Map();
  const send = msg => {
    calls.push(msg);
    if (msg.type !== 'send') return Promise.resolve({ ok: true });
    return new Promise(resolve => pending.set(msg.key, resolve));
  };
  return { send, calls, answer: (key, res) => { pending.get(key)(res); pending.delete(key); }, pending };
}

test('flowOrigins: one entry per host of blocks that will be sent', () => {
  const ws = makeWs();
  assert.deepEqual(flowOrigins(ws, ws.flows.f), ['https://one.test', 'https://two.test']);
  assert.deepEqual(flowOrigins(ws, ws.flows.f, { from: 'b' }), ['https://two.test']);
  ws.items.ra.deleted = true;
  assert.deepEqual(flowOrigins(ws, ws.flows.f), ['https://two.test']);
});

test('run writes the record, sends, merges updates and ends done', async () => {
  const ws = makeWs();
  const store = sharedStore();
  const s = controlledSend();
  const seen = [];
  const timers = fakeTimers();
  let t = 1000;
  const runner = createRunner({ flowId: 'f', getWs: () => ws, send: s.send, storage: store.page(), onRecord: r => seen.push(r), now: () => t, timers });
  const done = runner.run();
  await tick();
  const rec = store.data['flowRun:f'];
  assert.equal(rec.status, 'running');
  assert.equal(rec.snapshot.envId, 'e');
  assert.deepEqual(rec.snapshot.envVars, { base: 'https://one.test' });
  assert.ok(rec.snapshot.fingerprints.a && rec.snapshot.fingerprints.c);
  assert.equal(s.calls[0].type, 'send');
  assert.equal(s.calls[0].requestId, 'ra');
  assert.match(s.calls[0].key, /:a$/);
  t = 3000;
  timers.fire();
  await tick();
  assert.equal(store.data['flowRun:f'].beatAt, 3000);
  s.answer(s.calls[0].key, ok({ t: 'tok' }));
  await tick(); await tick();
  const bCall = s.calls.find(c => c.requestId === 'rb');
  assert.deepEqual(bCall.vars, { t: 'tok' });
  s.answer(bCall.key, ok({}));
  assert.equal(await done, true);
  await tick();
  const final = store.data['flowRun:f'];
  assert.equal(final.status, 'done');
  assert.equal(typeof final.totalMs, 'number');
  assert.equal(final.blocks.c.state, 'ok');
  assert.equal(final.blocks.c.mock, true);
  assert.equal(timers.count(), 1); // only the abandon watch remains
  assert.equal(seen.at(-1).status, 'done');
  runner.dispose();
});

test('stop aborts and cancels each in-flight send by key', async () => {
  const ws = makeWs();
  const s = controlledSend();
  const runner = createRunner({ flowId: 'f', getWs: () => ws, send: s.send, storage: sharedStore().page(), timers: fakeTimers() });
  const done = runner.run();
  await tick();
  runner.stop();
  await done;
  const cancel = s.calls.find(c => c.type === 'cancelSend');
  assert.equal(cancel.key, s.calls[0].key);
  assert.equal(runner.record.status, 'stopped');
  assert.equal(runner.record.blocks.a.errorKind, 'cancelled');
  assert.equal(runner.record.blocks.b.state, 'idle');
  runner.dispose();
});

test('stop from another page writes stopRequested and the runner stops', async () => {
  const ws = makeWs();
  const store = sharedStore();
  const s = controlledSend();
  const runner = createRunner({ flowId: 'f', getWs: () => ws, send: s.send, storage: store.page(), timers: fakeTimers() });
  const other = createRunner({ flowId: 'f', getWs: () => ws, send: async () => ({ ok: true }), storage: store.page(), timers: fakeTimers() });
  const done = runner.run();
  await tick(); await tick();
  assert.equal(other.record.status, 'running');
  assert.equal(other.isLive(), true);
  other.stop();
  await done;
  await tick(); await tick();
  assert.equal(store.data['flowRun:f'].status, 'stopped');
  assert.equal(other.record.status, 'stopped');
  assert.ok(s.calls.some(c => c.type === 'cancelSend'));
  runner.dispose(); other.dispose();
});

test('a watcher abandons a run whose heartbeat went stale', async () => {
  const ws = makeWs();
  const store = sharedStore();
  store.data['flowRun:f'] = { flowId: 'f', runId: 'old', status: 'running', startedAt: 0, beatAt: 0, stopRequested: false, snapshot: {}, blocks: { a: { state: 'running' } }, totalMs: null };
  const timers = fakeTimers();
  let t = 5000;
  const watcher = createRunner({ flowId: 'f', getWs: () => ws, send: async () => ({ ok: true }), storage: store.page(), now: () => t, timers });
  await tick();
  assert.equal(store.data['flowRun:f'].status, 'running');
  t = 6001;
  timers.fire();
  await tick();
  const rec = store.data['flowRun:f'];
  assert.equal(rec.status, 'abandoned');
  assert.equal(rec.note, ABANDONED_NOTE);
  assert.equal(rec.blocks.a.state, 'idle');
  watcher.dispose();
});

test('run from a block seeds out-of-scope blocks from the previous record', async () => {
  const ws = makeWs();
  const store = sharedStore();
  const s = controlledSend();
  const runner = createRunner({ flowId: 'f', getWs: () => ws, send: s.send, storage: store.page(), timers: fakeTimers() });
  const first = runner.run();
  await tick();
  s.answer(s.calls[0].key, ok({ t: 'tok' }));
  await tick(); await tick();
  s.answer(s.calls.find(c => c.requestId === 'rb').key, ok({}));
  await first;
  const prevFp = runner.record.snapshot.fingerprints.a;
  ws.items.ra = { ...ws.items.ra, url: '{{base}}/login2' };
  const second = runner.run({ from: 'b' });
  await tick();
  const rec = store.data['flowRun:f'];
  assert.equal(rec.blocks.a.state, 'ok');
  assert.equal(rec.snapshot.fingerprints.a, prevFp);
  assert.deepEqual(rec.scope, ['b']);
  const call = s.calls.filter(c => c.requestId === 'rb').at(-1);
  assert.deepEqual(call.vars, { t: 'tok' });
  s.answer(call.key, ok({}));
  await second;
  runner.dispose();
});

test('run does nothing while a live run exists', async () => {
  const ws = makeWs();
  const s = controlledSend();
  const runner = createRunner({ flowId: 'f', getWs: () => ws, send: s.send, storage: sharedStore().page(), timers: fakeTimers() });
  const done = runner.run();
  await tick();
  assert.equal(await runner.run(), false);
  runner.stop();
  await done;
  runner.dispose();
});

test('the end of a run fits all run records into the budget', async () => {
  const ws = makeWs();
  const store = sharedStore();
  const big = 'x'.repeat(9_000_000);
  store.data['flowRun:other'] = { flowId: 'other', runId: 'o', status: 'done', startedAt: 0, beatAt: 0, snapshot: {}, blocks: { z: { state: 'ok', response: { bodyText: big } } }, totalMs: 1 };
  const s = controlledSend();
  const runner = createRunner({ flowId: 'f', getWs: () => ws, send: s.send, storage: store.page(), timers: fakeTimers() });
  const done = runner.run();
  await tick();
  runner.stop();
  await done;
  await tick();
  assert.equal(store.data['flowRun:other'].blocks.z.response.bodyText, '');
  assert.equal(store.data['flowRun:other'].blocks.z.response.dropped, true);
  runner.dispose();
});

test('a write over the storage quota is retried without response bodies', async () => {
  const ws = makeWs();
  const store = sharedStore();
  const area = store.page();
  const set = area.set;
  area.set = async values => {
    if (JSON.stringify(values).length > 1_000_000) throw new Error('QUOTA_BYTES quota exceeded');
    return set(values);
  };
  const s = controlledSend();
  const runner = createRunner({ flowId: 'f', getWs: () => ws, send: s.send, storage: area, timers: fakeTimers() });
  const done = runner.run();
  await tick();
  s.answer(s.calls[0].key, ok({ t: 'tok', pad: 'x'.repeat(1_200_000) }));
  await tick(); await tick();
  const saved = store.data['flowRun:f'];
  assert.equal(saved.blocks.a.state, 'ok');
  assert.equal(saved.blocks.a.response.bodyText, '');
  assert.equal(saved.blocks.a.response.dropped, true);
  assert.equal(runner.record.blocks.a.response.bodyText.length > 1_000_000, true); // this page keeps the body
  runner.stop();
  await done;
  runner.dispose();
});

test('a later run arriving mid-run never takes this run\'s results', async () => {
  const ws = makeWs();
  const store = sharedStore();
  const s = controlledSend();
  let t = 1000;
  const runner = createRunner({ flowId: 'f', getWs: () => ws, send: s.send, storage: store.page(), now: () => t, timers: fakeTimers() });
  const done = runner.run();
  await tick();
  const ownId = store.data['flowRun:f'].runId;
  // Another page starts a later run in the same moment, then a stale fitAll writes an old record.
  const writer = store.page();
  await writer.set({ 'flowRun:f': { flowId: 'f', runId: 'later', status: 'running', startedAt: 1001, beatAt: 1001, stopRequested: false, snapshot: {}, blocks: {}, totalMs: null } });
  await tick(); await tick();
  assert.equal(store.data['flowRun:f'].runId, ownId);
  await writer.set({ 'flowRun:f': { flowId: 'f', runId: 'old', status: 'done', startedAt: 1, beatAt: 1, snapshot: {}, blocks: {}, totalMs: 5 } });
  await tick(); await tick();
  assert.equal(store.data['flowRun:f'].runId, ownId);
  s.answer(s.calls[0].key, ok({ t: 'tok' }));
  await tick(); await tick();
  s.answer(s.calls.find(c => c.requestId === 'rb').key, ok({}));
  assert.equal(await done, true);
  await tick();
  const final = store.data['flowRun:f'];
  assert.equal(final.runId, ownId);
  assert.equal(final.status, 'done');
  assert.equal(final.blocks.a.state, 'ok');
  runner.dispose();
});

test('an earlier run arriving mid-run wins: this run yields and writes nothing more', async () => {
  const ws = makeWs();
  const store = sharedStore();
  const s = controlledSend();
  const runner = createRunner({ flowId: 'f', getWs: () => ws, send: s.send, storage: store.page(), now: () => 1000, timers: fakeTimers() });
  const done = runner.run();
  await tick();
  const earlier = { flowId: 'f', runId: 'earlier', status: 'running', startedAt: 999, beatAt: 999, stopRequested: false, snapshot: {}, blocks: { a: { state: 'running' } }, totalMs: null };
  await store.page().set({ 'flowRun:f': earlier });
  assert.equal(await done, false);
  await tick(); await tick();
  assert.deepEqual(store.data['flowRun:f'], earlier);
  assert.equal(runner.record.runId, 'earlier');
  assert.ok(s.calls.some(c => c.type === 'cancelSend'));
  runner.dispose();
});

test('a throw during a run ends the record with a note and removes the listener', async () => {
  const ws = makeWs();
  const store = sharedStore();
  const area = store.page();
  let listeners = 0;
  const add = area.onChanged.addListener, remove = area.onChanged.removeListener;
  area.onChanged.addListener = fn => { listeners++; add(fn); };
  area.onChanged.removeListener = fn => { listeners--; remove(fn); };
  const timers = fakeTimers();
  const runner = createRunner({ flowId: 'f', getWs: () => ws, send: async () => ({ ok: true }), storage: area, timers });
  ws.items.ra.headers = null; // resolving the request inside runFlow throws on this
  const done = runner.run();
  runner.dispose();
  await assert.rejects(done);
  await tick();
  const rec = store.data['flowRun:f'];
  assert.equal(rec.status, 'stopped');
  assert.match(rec.note, /^Run failed: /);
  assert.equal(listeners, 0);
  assert.equal(timers.count(), 0);
});

test('a throw in a later block ends the record stopped with a note', async () => {
  const ws = makeWs();
  const store = sharedStore();
  const s = controlledSend();
  const timers = fakeTimers();
  const runner = createRunner({ flowId: 'f', getWs: () => ws, send: s.send, storage: store.page(), timers });
  ws.items.rb.headers = null; // b fails to resolve once a has answered
  const done = runner.run();
  await tick();
  s.answer(s.calls[0].key, ok({ t: 'tok' }));
  await assert.rejects(done);
  await tick();
  const rec = store.data['flowRun:f'];
  assert.equal(rec.status, 'stopped');
  assert.match(rec.note, /^Run failed: /);
  assert.equal(runner.isRunning(), false);
  assert.equal(runner.isLive(), false);
  assert.equal(timers.count(), 1); // only the abandon watch
  runner.dispose();
});
