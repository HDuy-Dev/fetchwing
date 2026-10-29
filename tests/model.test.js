import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorkspace, newRequest, applyMutation, children, liveRequests, pathOf } from '../src/lib/model.js';

const apply = (ws, m, now = 100) => {
  const r = applyMutation(ws, m, now);
  assert.ok(r.workspace, `mutation failed: ${r.error}`);
  return r.workspace;
};
const rootId = ws => children(ws, null)[0].id;

test('empty workspace has a collection and Local env', () => {
  const ws = emptyWorkspace();
  const roots = children(ws, null);
  assert.deepEqual(roots.map(i => [i.type, i.name]), [['collection', 'My Collection']]);
  const envs = Object.values(ws.environments);
  assert.deepEqual(envs.map(e => [e.name, e.vars]), [['Local', []]]);
  assert.equal(ws.activeEnvId, envs[0].id);
});

test('newRequest defaults', () => {
  assert.deepEqual(newRequest({ url: 'https://x.dev' }), {
    method: 'GET', url: 'https://x.dev', headers: [],
    body: { mode: 'none', raw: '', fields: [] },
    mock: { enabled: false, status: 200, headers: [], body: '', delayMs: 0 },
  });
});

test('adds folder and request under collection', () => {
  let ws = emptyWorkspace();
  const c = rootId(ws);
  ws = apply(ws, { type: 'addItem', id: 'f1', itemType: 'folder', parentId: c, name: 'Users' });
  ws = apply(ws, { type: 'addItem', id: 'r1', itemType: 'request', parentId: 'f1', name: 'List', fields: { method: 'POST' } });
  ws = apply(ws, { type: 'addItem', id: 'r2', itemType: 'request', parentId: 'f1', name: 'Get' });
  assert.deepEqual(children(ws, 'f1').map(i => [i.id, i.order]), [['r1', 0], ['r2', 1]]);
  assert.equal(ws.items.r1.method, 'POST');
  assert.equal(ws.items.r1.mock.enabled, false);
  assert.deepEqual(pathOf(ws, 'r1'), ['My Collection', 'Users', 'List']);
  ws = apply(ws, { type: 'addItem', id: 'c2', itemType: 'collection', parentId: null, name: 'Other' });
  assert.deepEqual(children(ws, null).map(i => i.id), [c, 'c2']);
});

test('rejects invalid parents', () => {
  let ws = emptyWorkspace();
  ws = apply(ws, { type: 'addItem', id: 'r1', itemType: 'request', parentId: rootId(ws), name: 'R' });
  assert.deepEqual(applyMutation(ws, { type: 'addItem', id: 'x', itemType: 'request', parentId: 'r1', name: 'X' }, 1), { error: 'invalid_parent' });
  assert.deepEqual(applyMutation(ws, { type: 'addItem', id: 'x', itemType: 'folder', parentId: null, name: 'X' }, 1), { error: 'invalid_parent' });
  assert.deepEqual(applyMutation(ws, { type: 'addItem', id: 'x', itemType: 'collection', parentId: rootId(ws), name: 'X' }, 1), { error: 'invalid_parent' });
});

test('renameItem trims and rejects empty', () => {
  let ws = emptyWorkspace();
  ws = apply(ws, { type: 'renameItem', id: rootId(ws), name: '  API  ' });
  assert.equal(children(ws, null)[0].name, 'API');
  assert.deepEqual(applyMutation(ws, { type: 'renameItem', id: rootId(ws), name: ' ' }, 1), { error: 'empty_name' });
});

test('moveItem reorders siblings and moves between parents', () => {
  let ws = emptyWorkspace();
  const c = rootId(ws);
  for (const id of ['a', 'b', 'c']) ws = apply(ws, { type: 'addItem', id, itemType: 'request', parentId: c, name: id });
  ws = apply(ws, { type: 'moveItem', id: 'c', parentId: c, order: 0 });
  assert.deepEqual(children(ws, c).map(i => i.id), ['c', 'a', 'b']);
  ws = apply(ws, { type: 'addItem', id: 'f', itemType: 'folder', parentId: c, name: 'F' });
  ws = apply(ws, { type: 'moveItem', id: 'a', parentId: 'f', order: 0 });
  assert.deepEqual(children(ws, c).map(i => [i.id, i.order]), [['c', 0], ['b', 1], ['f', 2]]);
  assert.deepEqual(children(ws, 'f').map(i => i.id), ['a']);
});

test('moveItem rejects moving into descendant or under a request', () => {
  let ws = emptyWorkspace();
  const c = rootId(ws);
  ws = apply(ws, { type: 'addItem', id: 'f1', itemType: 'folder', parentId: c, name: 'F1' });
  ws = apply(ws, { type: 'addItem', id: 'f2', itemType: 'folder', parentId: 'f1', name: 'F2' });
  ws = apply(ws, { type: 'addItem', id: 'r', itemType: 'request', parentId: c, name: 'R' });
  assert.deepEqual(applyMutation(ws, { type: 'moveItem', id: 'f1', parentId: 'f2', order: 0 }, 1), { error: 'invalid_move' });
  assert.deepEqual(applyMutation(ws, { type: 'moveItem', id: 'f1', parentId: 'f1', order: 0 }, 1), { error: 'invalid_move' });
  assert.deepEqual(applyMutation(ws, { type: 'moveItem', id: 'f2', parentId: 'r', order: 0 }, 1), { error: 'invalid_move' });
  assert.deepEqual(applyMutation(ws, { type: 'moveItem', id: 'f1', parentId: null, order: 0 }, 1), { error: 'invalid_move' });
});

test('deleteItem tombstones subtree', () => {
  let ws = emptyWorkspace();
  const c = rootId(ws);
  ws = apply(ws, { type: 'addItem', id: 'f', itemType: 'folder', parentId: c, name: 'F' });
  ws = apply(ws, { type: 'addItem', id: 'r', itemType: 'request', parentId: 'f', name: 'R' });
  ws = apply(ws, { type: 'deleteItem', id: 'f' }, 200);
  assert.equal(ws.items.f.deleted, true);
  assert.equal(ws.items.r.deleted, true);
  assert.equal(ws.items.r.updatedAt, 200);
  assert.deepEqual(liveRequests(ws), []);
});

test('updateRequest, updateMock and setMockEnabled touch updatedAt', () => {
  let ws = emptyWorkspace();
  ws = apply(ws, { type: 'addItem', id: 'r', itemType: 'request', parentId: rootId(ws), name: 'R' }, 1);
  ws = apply(ws, { type: 'updateRequest', id: 'r', patch: { url: 'https://x.dev', method: 'PUT', mock: { enabled: true } } }, 5);
  assert.equal(ws.items.r.url, 'https://x.dev');
  assert.equal(ws.items.r.method, 'PUT');
  assert.equal(ws.items.r.mock.enabled, false, 'updateRequest must not change the mock');
  assert.equal(ws.items.r.updatedAt, 5);
  ws = apply(ws, { type: 'updateMock', id: 'r', patch: { status: 404, body: '{}', enabled: true } }, 6);
  assert.deepEqual([ws.items.r.mock.status, ws.items.r.mock.body, ws.items.r.mock.enabled], [404, '{}', false]);
  ws = apply(ws, { type: 'setMockEnabled', id: 'r', enabled: true }, 7);
  assert.equal(ws.items.r.mock.enabled, true);
  assert.equal(ws.items.r.updatedAt, 7);
  assert.deepEqual(applyMutation(ws, { type: 'updateMock', id: rootId(ws), patch: {} }, 1), { error: 'not_found' });
});

test('environments: add, update, delete active picks another', () => {
  let ws = emptyWorkspace();
  const local = ws.activeEnvId;
  ws = apply(ws, { type: 'addEnvironment', id: 'stg', name: 'Staging' });
  ws = apply(ws, { type: 'updateEnvironment', id: 'stg', patch: { vars: [{ key: 'base', value: 'https://s', secret: false }] } });
  ws = apply(ws, { type: 'setActiveEnv', id: 'stg' });
  assert.equal(ws.activeEnvId, 'stg');
  ws = apply(ws, { type: 'deleteEnvironment', id: 'stg' });
  assert.equal(ws.environments.stg.deleted, true);
  assert.equal(ws.activeEnvId, local);
  ws = apply(ws, { type: 'deleteEnvironment', id: local });
  assert.equal(ws.activeEnvId, null);
  assert.deepEqual(applyMutation(ws, { type: 'setActiveEnv', id: 'nope' }, 1), { error: 'not_found' });
});

test('applyMutation does not mutate input', () => {
  const ws = emptyWorkspace();
  const before = structuredClone(ws);
  applyMutation(ws, { type: 'addItem', id: 'r', itemType: 'request', parentId: rootId(ws), name: 'R' }, 1);
  applyMutation(ws, { type: 'renameItem', id: rootId(ws), name: 'Z' }, 1);
  assert.deepEqual(ws, before);
  assert.deepEqual(applyMutation(ws, { type: 'bogus' }, 1), { error: 'bad_mutation' });
});

test('disableAllMocks turns all off and touches only those', () => {
  let ws = emptyWorkspace();
  const c = rootId(ws);
  for (const id of ['a', 'b', 'c']) ws = apply(ws, { type: 'addItem', id, itemType: 'request', parentId: c, name: id }, 1);
  ws = apply(ws, { type: 'setMockEnabled', id: 'a', enabled: true }, 2);
  ws = apply(ws, { type: 'setMockEnabled', id: 'b', enabled: true }, 2);
  ws = apply(ws, { type: 'disableAllMocks' }, 9);
  assert.deepEqual(['a', 'b', 'c'].map(id => ws.items[id].mock.enabled), [false, false, false]);
  assert.deepEqual(['a', 'b', 'c'].map(id => ws.items[id].updatedAt), [9, 9, 1]);
});
