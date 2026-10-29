import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toRemote, isPristine, mergeRemote, REMOTE_VERSION } from '../src/lib/sync-merge.js';
import { emptyWorkspace, newRequest } from '../src/lib/model.js';

const item = (id, updatedAt, extra = {}) => ({
  id, type: 'request', parentId: 'c', order: 0, name: id, updatedAt, deleted: false, ...newRequest(), ...extra,
});
const env = (id, updatedAt, vars = [], extra = {}) => ({ id, name: id, order: 0, vars, updatedAt, deleted: false, ...extra });
const ws = (items = {}, environments = {}, activeEnvId = Object.keys(environments)[0] ?? null) => ({ items, environments, activeEnvId });

test('toRemote strips secrets, mock on/off and activeEnvId', () => {
  const local = ws(
    { a: item('a', 1, { mock: { ...newRequest().mock, enabled: true } }) },
    { e: env('e', 2, [{ key: 'token', value: 's3cret', secret: true }, { key: 'base', value: 'x', secret: false }]) },
  );
  const remote = toRemote(local);
  assert.equal(remote.version, REMOTE_VERSION);
  assert.equal('activeEnvId' in remote, false);
  assert.equal(remote.items.a.mock.enabled, false);
  assert.deepEqual(remote.environments.e.vars, [{ key: 'token', value: '', secret: true }, { key: 'base', value: 'x', secret: false }]);
  assert.equal(local.environments.e.vars[0].value, 's3cret', 'input not mutated');
  assert.equal(local.items.a.mock.enabled, true, 'input not mutated');
});

test('isPristine only for untouched defaults', () => {
  assert.equal(isPristine(emptyWorkspace()), true);
  assert.equal(isPristine(ws({ a: item('a', 3) })), false);
});

test('keeps edits from both sides', () => {
  const local = ws({ a: item('a', 5, { name: 'A local' }), b: item('b', 1, { name: 'B old' }) });
  const remote = toRemote(ws({ a: item('a', 1, { name: 'A old' }), b: item('b', 7, { name: 'B remote' }) }));
  const { workspace, upload } = mergeRemote(local, remote);
  assert.equal(workspace.items.a.name, 'A local');
  assert.equal(workspace.items.b.name, 'B remote');
  assert.equal(upload, true);
});

test('later edit wins the whole item; tie keeps local', () => {
  const remote = toRemote(ws({ a: item('a', 9, { name: 'R', url: 'r' }) }));
  const res = mergeRemote(ws({ a: item('a', 4, { name: 'L', url: 'l' }) }), remote);
  assert.equal(res.workspace.items.a.name, 'R');
  assert.equal(res.workspace.items.a.url, 'r');
  assert.equal(res.upload, false);
  const tie = mergeRemote(ws({ a: item('a', 9, { name: 'L' }) }), remote);
  assert.equal(tie.workspace.items.a.name, 'L');
  assert.equal(tie.upload, false);
});

test('items only on one side are kept', () => {
  const localOnly = mergeRemote(ws({ a: item('a', 2), b: item('b', 2) }), toRemote(ws({ a: item('a', 2) })));
  assert.ok(localOnly.workspace.items.b);
  assert.equal(localOnly.upload, true);
  const remoteOnly = mergeRemote(ws({ a: item('a', 2) }), toRemote(ws({ a: item('a', 2), r: item('r', 3) })));
  assert.ok(remoteOnly.workspace.items.r);
  assert.equal(remoteOnly.upload, false);
});

test('tombstones win when newer and are kept', () => {
  const res = mergeRemote(ws({ a: item('a', 3) }), toRemote(ws({ a: item('a', 8, { deleted: true }) })));
  assert.equal(res.workspace.items.a.deleted, true);
  const back = mergeRemote(ws({ a: item('a', 8, { deleted: true }) }), toRemote(ws({ a: item('a', 3) })));
  assert.equal(back.workspace.items.a.deleted, true);
  assert.equal(back.upload, true);
});

test('secret values never leave and survive a remote win', () => {
  const local = ws({}, { e: env('e', 2, [{ key: 'token', value: 's3cret', secret: true }, { key: 'base', value: 'x', secret: false }]) });
  assert.equal(toRemote(local).environments.e.vars[0].value, '');
  const remote = toRemote(ws({}, { e: env('e', 9, [{ key: 'token', value: '', secret: true }, { key: 'base', value: 'y', secret: false }]) }));
  const merged = mergeRemote(local, remote).workspace.environments.e.vars;
  assert.deepEqual(merged, [{ key: 'token', value: 's3cret', secret: true }, { key: 'base', value: 'y', secret: false }]);
});

test('mock on/off stays per device', () => {
  const on = { ...newRequest().mock, enabled: true };
  const remote = toRemote(ws({ a: item('a', 9, { mock: { ...on, body: 'remote' } }), b: item('b', 9) }));
  const res = mergeRemote(ws({ a: item('a', 2, { mock: on }) }), remote);
  assert.equal(res.workspace.items.a.mock.enabled, true);
  assert.equal(res.workspace.items.a.mock.body, 'remote');
  assert.equal(res.workspace.items.b.mock.enabled, false);
});

test('activeEnvId is local; falls back when its env is deleted', () => {
  const local = ws({}, { e1: env('e1', 1, [], { order: 0 }), e2: env('e2', 1, [], { order: 1 }) }, 'e2');
  const kept = mergeRemote(local, toRemote(ws({}, { e1: env('e1', 1, [], { order: 0 }), e2: env('e2', 1, [], { order: 1 }) }, 'e1')));
  assert.equal(kept.workspace.activeEnvId, 'e2');
  const gone = mergeRemote(local, toRemote(ws({}, { e2: env('e2', 9, [], { order: 1, deleted: true }) })));
  assert.equal(gone.workspace.activeEnvId, 'e1');
  const none = mergeRemote(ws({}, { e: env('e', 1) }, 'e'), toRemote(ws({}, { e: env('e', 9, [], { deleted: true }) })));
  assert.equal(none.workspace.activeEnvId, null);
});

test('pristine local adopts remote', () => {
  const local = emptyWorkspace();
  const remote = toRemote(ws({ c: item('c', 3, { type: 'collection', name: 'Shop' }) }, { e: env('e', 3, []) }));
  const { workspace, upload } = mergeRemote(local, remote);
  assert.deepEqual(Object.keys(workspace.items), ['c']);
  assert.deepEqual(Object.keys(workspace.environments), ['e']);
  assert.equal(workspace.activeEnvId, 'e');
  assert.equal(upload, false);
});

test('no remote file: upload everything', () => {
  const local = ws({ a: item('a', 2) }, { e: env('e', 1) });
  const { workspace, upload } = mergeRemote(local, null);
  assert.deepEqual(workspace, local);
  assert.notEqual(workspace, local);
  assert.equal(upload, true);
});
