import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorkspace, applyMutation, children } from '../src/lib/model.js';
import { deriveActiveMocks, findDuplicate } from '../src/lib/mocks.js';
import { matchKey } from '../src/lib/match.js';

function workspace() {
  let ws = emptyWorkspace();
  const c = children(ws, null)[0].id;
  const run = m => { ws = applyMutation(ws, m, 1).workspace; };
  run({ type: 'updateEnvironment', id: ws.activeEnvId, patch: { vars: [{ key: 'base', value: 'http://localhost:3000' }] } });
  run({ type: 'addItem', id: 'a', itemType: 'request', parentId: c, name: 'Users', fields: { url: '{{base}}/api/users?page=2&size=10' } });
  run({ type: 'addItem', id: 'b', itemType: 'request', parentId: c, name: 'Users again', fields: { url: 'http://localhost:3000/api/users?size=10&page=2' } });
  run({ type: 'addItem', id: 'c', itemType: 'request', parentId: c, name: 'Missing var', fields: { url: '{{nope}}/x' } });
  run({ type: 'updateMock', id: 'a', patch: { status: 201, body: '{"ok":true}', delayMs: 5, headers: [{ key: 'x-a', value: '1' }] } });
  return { get ws() { return ws; }, run };
}

test('deriveActiveMocks resolves env vars and skips missing', () => {
  const w = workspace();
  assert.deepEqual(deriveActiveMocks(w.ws), []);
  w.run({ type: 'setMockEnabled', id: 'a', enabled: true });
  w.run({ type: 'setMockEnabled', id: 'c', enabled: true });
  assert.deepEqual(deriveActiveMocks(w.ws), [{
    key: matchKey('GET', 'http://localhost:3000/api/users?page=2&size=10'),
    method: 'GET',
    url: 'http://localhost:3000/api/users?page=2&size=10',
    status: 201,
    headers: [{ key: 'x-a', value: '1' }],
    body: '{"ok":true}',
    delayMs: 5,
    requestId: 'a',
    name: 'Users',
  }]);
});

test('deleted requests drop out of active mocks', () => {
  const w = workspace();
  w.run({ type: 'setMockEnabled', id: 'a', enabled: true });
  w.run({ type: 'deleteItem', id: 'a' });
  assert.deepEqual(deriveActiveMocks(w.ws), []);
});

test('findDuplicate finds same key ignoring query order', () => {
  const w = workspace();
  assert.equal(findDuplicate(w.ws, 'b'), null);
  w.run({ type: 'setMockEnabled', id: 'a', enabled: true });
  assert.equal(findDuplicate(w.ws, 'b')?.id, 'a');
  assert.equal(findDuplicate(w.ws, 'a'), null);
});
