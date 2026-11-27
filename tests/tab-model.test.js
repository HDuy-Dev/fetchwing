import test from 'node:test';
import assert from 'node:assert/strict';
import { tabKind, insertTab, pruneTabs } from '../src/lib/tab-model.js';

const ws = {
  items: { r1: { type: 'request' }, r2: { type: 'request' }, f: { type: 'folder' }, gone: { type: 'request', deleted: true } },
  environments: { e1: {}, dead: { deleted: true } },
};

test('tabKind knows requests and environments only', () => {
  assert.deepEqual(['r1', 'e1', 'f', 'gone', 'dead', 'nope', null].map(id => tabKind(ws, id)),
    ['request', 'env', null, null, null, null, null]);
});

test('insertTab opens next to the given tab, once', () => {
  assert.deepEqual(insertTab(['a', 'b'], 'e', 'a'), ['a', 'e', 'b']);
  assert.deepEqual(insertTab(['a', 'b'], 'e', null), ['a', 'b', 'e']);
  assert.deepEqual(insertTab(['a', 'b'], 'b', 'a'), ['a', 'b']);
});

test('pruneTabs drops dead tabs', () => {
  assert.deepEqual(pruneTabs(ws, ['r1', 'dead', 'e1', 'gone', 'nope'], 'e1'), { ids: ['r1', 'e1'], selectedId: 'e1' });
});

test('pruneTabs moves a dead selection to the next tab, else the previous', () => {
  assert.equal(pruneTabs(ws, ['r1', 'dead', 'r2'], 'dead').selectedId, 'r2');
  assert.equal(pruneTabs(ws, ['r1', 'dead'], 'dead').selectedId, 'r1');
  assert.equal(pruneTabs(ws, ['dead'], 'dead').selectedId, null);
});

test('pruneTabs keeps a selected folder', () => {
  assert.equal(pruneTabs(ws, ['r1'], 'f').selectedId, 'f');
});
