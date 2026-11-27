import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorkspace, newRequest, applyMutation, children, liveRequests, pathOf, liveFlows } from '../src/lib/model.js';

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
    script: '',
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

test('flows: add, update, delete', () => {
  let ws = apply(emptyWorkspace(), { type: 'addFlow', id: 'f', name: '  ' });
  assert.equal(ws.flows.f.name, 'Untitled flow');
  assert.deepEqual([ws.flows.f.blocks, ws.flows.f.edges], [[], []]);
  const blocks = [{ id: 'a', kind: 'request', requestId: 'r1', x: 0, y: 0, outputs: [] },
                  { id: 'b', kind: 'request', requestId: 'r2', x: 0, y: 0, outputs: [] }];
  ws = apply(ws, { type: 'updateFlow', id: 'f', patch: { name: 'Checkout', blocks, edges: [{ from: 'a', to: 'b' }] } }, 200);
  assert.equal(ws.flows.f.updatedAt, 200);
  ws = apply(ws, { type: 'deleteFlow', id: 'f' });
  assert.deepEqual(liveFlows(ws), []);
});

test('updateFlow rejects cycles and bad edges', () => {
  const ws = apply(emptyWorkspace(), { type: 'addFlow', id: 'f', name: 'F' });
  const blocks = ['a', 'b'].map(id => ({ id, kind: 'request', requestId: 'r', x: 0, y: 0, outputs: [] }));
  const up = edges => applyMutation(ws, { type: 'updateFlow', id: 'f', patch: { blocks, edges } }, 1).error;
  assert.equal(up([{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }]), 'cycle');
  assert.equal(up([{ from: 'a', to: 'a' }]), 'invalid_edge');
  assert.equal(up([{ from: 'a', to: 'zz' }]), 'invalid_edge');
  assert.equal(up([{ from: 'a', to: 'b' }, { from: 'a', to: 'b' }]), 'invalid_edge');
});

test('workspaces saved before flows still work', () => {
  const old = emptyWorkspace(); delete old.flows;
  assert.deepEqual(liveFlows(old), []);
  const ws = apply(old, { type: 'addFlow', id: 'f', name: 'F' });
  assert.ok(ws.flows.f);
  assert.ok(apply(old, { type: 'addEnvironment', id: 'e2', name: 'X' }).flows);
});

test('updateRequest saves script', () => {
  let ws = emptyWorkspace();
  ws = apply(ws, { type: 'addItem', id: 'r1', itemType: 'request', parentId: rootId(ws), name: 'R' });
  ws = apply(ws, { type: 'updateRequest', id: 'r1', patch: { script: 'console.log(1)' } });
  assert.equal(ws.items.r1.script, 'console.log(1)');
});

const envWith = vars => {
  let ws = emptyWorkspace();
  ws = apply(ws, { type: 'addEnvironment', id: 'e', name: 'E' });
  return apply(ws, { type: 'updateEnvironment', id: 'e', patch: { vars } });
};

test('applyEnvChanges sets, updates and unsets by key', () => {
  const ws = envWith([{ key: 'a', value: '1', secret: true }, { key: 'b', value: '2', secret: false }]);
  const out = apply(ws, { type: 'applyEnvChanges', id: 'e', changes: [
    { op: 'set', key: 'a', value: '9' }, { op: 'set', key: 'c', value: '3' }, { op: 'unset', key: 'b' },
  ] }, 500);
  assert.deepEqual(out.environments.e.vars, [{ key: 'a', value: '9', secret: true }, { key: 'c', value: '3', secret: false }]);
  assert.equal(out.environments.e.updatedAt, 500);
});

test('applyEnvChanges on missing env', () => {
  assert.deepEqual(applyMutation(emptyWorkspace(), { type: 'applyEnvChanges', id: 'nope', changes: [] }, 1), { error: 'not_found' });
});

test('applyEnvChanges ignores empty keys', () => {
  const out = apply(envWith([]), { type: 'applyEnvChanges', id: 'e', changes: [{ op: 'set', key: '', value: 'x' }] });
  assert.deepEqual(out.environments.e.vars, []);
});

test('sameRequestContent compares the script, treating a missing one as empty', async () => {
  const { sameRequestContent } = await import('../src/lib/model.js');
  const base = newRequest({ url: 'u' });
  const legacy = { ...base };
  delete legacy.script;
  assert.equal(sameRequestContent({ ...base, script: '' }, legacy), true);
  assert.equal(sameRequestContent({ ...base, script: 'a' }, { ...base, script: 'b' }), false);
  assert.equal(sameRequestContent({ ...base, url: 'x' }, base), false);
});

test('applyEnvChanges with duplicate keys sets the last one and unsets all', () => {
  const ws = envWith([{ key: 't', value: 'a', secret: false }, { key: 't', value: 'b', secret: true }, { key: 'd', value: '1', secret: false }, { key: 'd', value: '2', secret: false }]);
  const out = apply(ws, { type: 'applyEnvChanges', id: 'e', changes: [{ op: 'set', key: 't', value: 'new' }, { op: 'unset', key: 'd' }] });
  assert.deepEqual(out.environments.e.vars, [{ key: 't', value: 'a', secret: false }, { key: 't', value: 'new', secret: true }]);
});

test('updateFlow keeps logic blocks and unknown block fields', () => {
  let ws = apply(emptyWorkspace(), { type: 'addFlow', id: 'f', name: 'F' });
  const blocks = [{ id: 'l', kind: 'logic', name: 'Calc', script: 'return { a: 1 }', x: 0, y: 0, outputs: [{ name: 'a' }], extra: 1 }];
  ws = apply(ws, { type: 'updateFlow', id: 'f', patch: { blocks } }, 5);
  assert.deepEqual(ws.flows.f.blocks, blocks);
});

test('updateBlock merges a patch into the latest copy of one block', () => {
  let ws = apply(emptyWorkspace(), { type: 'addFlow', id: 'f', name: 'F' });
  const blocks = [{ id: 'l', kind: 'logic', name: 'Logic', script: 'old', x: 0, y: 0, outputs: [] }, { id: 'r', kind: 'request', requestId: 'q', x: 0, y: 0, outputs: [] }];
  ws = apply(ws, { type: 'updateFlow', id: 'f', patch: { blocks } }, 1);
  // Two saves sent from the same stale view: the script edit, then an outputs edit.
  ws = apply(ws, { type: 'updateBlock', id: 'f', blockId: 'l', patch: { script: 'new' } }, 2);
  ws = apply(ws, { type: 'updateBlock', id: 'f', blockId: 'l', patch: { outputs: [{ name: 'total' }] } }, 3);
  assert.deepEqual(ws.flows.f.blocks[0], { ...blocks[0], script: 'new', outputs: [{ name: 'total' }] });
  assert.deepEqual(ws.flows.f.blocks[1], blocks[1]);
  assert.equal(ws.flows.f.updatedAt, 3);
  assert.equal(applyMutation(ws, { type: 'updateBlock', id: 'f', blockId: 'zz', patch: { x: 1 } }, 4).error, 'not_found');
  assert.equal(applyMutation(ws, { type: 'updateBlock', id: 'f', blockId: 'l', patch: { id: 'other' } }, 4).workspace.flows.f.blocks[0].id, 'l');
});
