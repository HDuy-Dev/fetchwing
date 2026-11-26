import test from 'node:test';
import assert from 'node:assert/strict';
import { RECORD_PREFIX, HEARTBEAT_MS, STALE_MS, newRecord, isAbandoned, abandon, blockStatus, runFromHere, fitRecords } from '../src/lib/flow-record.js';

const blk = (id, requestId = id, outputs = [], x = 0, y = 0) => ({ id, kind: 'request', requestId, x, y, outputs });
const mkFlow = () => ({
  id: 'f', name: 'F',
  blocks: [blk('a', 'ra', [{ name: 't', path: 'body.t' }]), blk('b'), blk('c')],
  edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }],
});
const mkRecord = (flow = mkFlow(), extra = {}) => ({
  ...newRecord({ flowId: 'f', runId: 'r', startedAt: 1000, snapshot: { flow, fingerprints: { a: 'fa', b: 'fb' } } }),
  blocks: { a: { state: 'ok' }, b: { state: 'ok' }, c: { state: 'idle' } },
  ...extra,
});
const opts = { envChanged: false, outdatedIds: [] };

test('constants', () => {
  assert.equal(RECORD_PREFIX, 'flowRun:');
  assert.equal(HEARTBEAT_MS, 2000);
  assert.equal(STALE_MS, 6000);
});

test('newRecord shape', () => {
  const r = newRecord({ flowId: 'f', runId: 'r', startedAt: 5, snapshot: { flow: mkFlow(), fingerprints: {} } });
  assert.equal(r.status, 'running');
  assert.equal(r.beatAt, 5);
  assert.equal(r.stopRequested, false);
  assert.deepEqual(r.blocks, {});
  assert.equal(r.totalMs, null);
});

test('isAbandoned uses the stale threshold', () => {
  const r = { status: 'running', beatAt: 10000 };
  assert.equal(isAbandoned(r, 10000 + 6001), true);
  assert.equal(isAbandoned(r, 10000 + 5999), false);
  assert.equal(isAbandoned({ status: 'done', beatAt: 0 }, 99999), false);
});

test('abandon resets running and queued blocks without mutating', () => {
  const r = mkRecord(mkFlow(), { blocks: { a: { state: 'running' }, b: { state: 'queued' }, c: { state: 'ok' } } });
  const out = abandon(r);
  assert.equal(out.status, 'abandoned');
  assert.deepEqual(Object.values(out.blocks).map(b => b.state), ['idle', 'idle', 'ok']);
  assert.equal(r.status, 'running');
  assert.equal(r.blocks.a.state, 'running');
});

test('blockStatus compares fingerprints', () => {
  const r = mkRecord();
  assert.deepEqual(blockStatus(r, 'a', 'fa'), { outdated: false });
  assert.deepEqual(blockStatus(r, 'a', 'zz'), { outdated: true });
  assert.deepEqual(blockStatus(r, 'c', 'zz'), { outdated: false });
});

test('runFromHere enabled for an unchanged flow', () => {
  assert.deepEqual(runFromHere(mkRecord(), mkFlow(), 'c', opts), { enabled: true, warn: null });
});

test('runFromHere disabled without a record or when upstream is not ok', () => {
  assert.equal(runFromHere(null, mkFlow(), 'c', opts).enabled, false);
  const r = mkRecord(mkFlow(), { blocks: { a: { state: 'ok' }, b: { state: 'failed' } } });
  assert.equal(runFromHere(r, mkFlow(), 'c', opts).enabled, false);
});

test('runFromHere disabled after an upstream edge is removed', () => {
  const cur = mkFlow();
  cur.edges = [{ from: 'b', to: 'c' }];
  assert.equal(runFromHere(mkRecord(), cur, 'c', opts).enabled, false);
});

test('runFromHere disabled when upstream outputs or request change, or block missing', () => {
  const o = mkFlow();
  o.blocks[0].outputs = [{ name: 't', path: 'body.other' }];
  assert.equal(runFromHere(mkRecord(), o, 'c', opts).enabled, false);
  const q = mkFlow();
  q.blocks[1].requestId = 'other';
  assert.equal(runFromHere(mkRecord(), q, 'c', opts).enabled, false);
  assert.equal(runFromHere(mkRecord(), mkFlow(), 'zzz', opts).enabled, false);
});

test('runFromHere ignores positions and names', () => {
  const cur = mkFlow();
  cur.name = 'Renamed';
  cur.blocks[0].x = 500;
  cur.blocks[2].y = 90;
  assert.equal(runFromHere(mkRecord(), cur, 'c', opts).enabled, true);
});

test('runFromHere ignores changes to unrelated blocks', () => {
  const cur = mkFlow();
  cur.blocks.push(blk('d'));
  cur.edges.push({ from: 'd', to: 'a' }); // d is upstream of a -> relevant
  assert.equal(runFromHere(mkRecord(), cur, 'c', opts).enabled, false);
  const cur2 = mkFlow();
  cur2.blocks.push(blk('e'));
  cur2.edges.push({ from: 'c', to: 'e' }); // downstream only
  assert.equal(runFromHere(mkRecord(), cur2, 'c', opts).enabled, true);
});

test('runFromHere warns on env change or outdated upstream', () => {
  const w = 'Using outputs from an earlier run';
  assert.deepEqual(runFromHere(mkRecord(), mkFlow(), 'c', { envChanged: true, outdatedIds: [] }), { enabled: true, warn: w });
  assert.equal(runFromHere(mkRecord(), mkFlow(), 'c', { envChanged: false, outdatedIds: new Set(['a']) }).warn, w);
  assert.equal(runFromHere(mkRecord(), mkFlow(), 'c', { envChanged: false, outdatedIds: ['c'] }).warn, null);
});

const big = (id, startedAt, n) => ({
  flowId: id, startedAt,
  blocks: { a: { state: 'ok', response: { status: 200, headers: [], bodyText: 'x'.repeat(n) } } },
});

test('fitRecords drops oldest bodies first and keeps the newest', () => {
  const recs = [big('new', 3, 1000), big('old', 1, 1000), big('mid', 2, 1000)];
  const size = JSON.stringify(recs).length;
  const out = fitRecords(recs, size - 1500);
  const by = Object.fromEntries(out.map(r => [r.flowId, r.blocks.a.response]));
  assert.equal(by.old.dropped, true);
  assert.equal(by.old.bodyText, '');
  assert.equal(by.old.status, 200);
  assert.equal(by.mid.dropped, true);
  assert.equal(by.new.bodyText.length, 1000);
  assert.equal(recs[1].blocks.a.response.bodyText.length, 1000); // inputs untouched
  assert.equal(out[0].flowId, 'new'); // order preserved
});

test('fitRecords returns input unchanged when it fits', () => {
  const recs = [big('a', 1, 10)];
  assert.deepEqual(fitRecords(recs), recs);
});

test('envChanged compares the snapshot env id and values', async () => {
  const { envChanged } = await import('../src/lib/flow-record.js');
  const r = { snapshot: { envId: 'e1', envVars: { base: 'x' } } };
  assert.equal(envChanged(r, 'e1', { base: 'x' }), false);
  assert.equal(envChanged(r, 'e2', { base: 'x' }), true);
  assert.equal(envChanged(r, 'e1', { base: 'y' }), true);
  assert.equal(envChanged(null, 'e1', {}), false);
  assert.equal(envChanged({ snapshot: {} }, 'e1', {}), false);
});

test('runSummary: not run, running, done, stopped, abandoned', async () => {
  const { runSummary } = await import('../src/lib/flow-record.js');
  const text = g => g.map(parts => parts.map(p => p.text).join(' ')).join(' · ');
  assert.equal(text(runSummary(null)), 'Not run yet');
  const running = { status: 'running', totalMs: null, scope: ['a', 'b', 'c', 'd'],
    blocks: { a: { state: 'ok' }, b: { state: 'running' }, c: { state: 'queued' }, d: { state: 'missing' }, z: { state: 'ok' } } };
  assert.equal(text(runSummary(running)), 'Running 1/3… · ✓2 !1');
  const done = { status: 'done', totalMs: 1234.4,
    blocks: { a: { state: 'ok', mock: true }, b: { state: 'failed' }, c: { state: 'skipped' }, d: { state: 'missing' } } };
  assert.equal(text(runSummary(done)), '✓1 ✕1 ⊘1 !1 · 1 mock · 1234 ms');
  assert.equal(text(runSummary({ ...done, status: 'stopped' })), 'Stopped · ✓1 ✕1 ⊘1 !1 · 1 mock · 1234 ms');
  assert.equal(text(runSummary({ status: 'abandoned', note: 'Gone', totalMs: null, blocks: { a: { state: 'idle' } } })), 'Gone');
});

test('fitRecords measures UTF-8 bytes, not characters', () => {
  const recs = [big('old', 1, 0), big('new', 2, 0)];
  for (const r of recs) r.blocks.a.response.bodyText = '€'.repeat(1000); // 3 bytes each
  const chars = JSON.stringify(recs).length;
  const out = fitRecords(recs, chars + 100); // fits by characters, not by bytes
  assert.equal(out[0].blocks.a.response.dropped, true);
});
