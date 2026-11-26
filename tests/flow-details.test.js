import test from 'node:test';
import assert from 'node:assert/strict';
import { outputHighlights, newOutputFor, outputError } from '../src/panel/flow-details.js';
import { pathKey } from '../src/panel/json-view.js';

test('outputHighlights maps each body path an output reads to its name', () => {
  const body = { data: { token: 't', userId: 42 }, items: [{ id: 7 }, { id: 9 }] };
  const map = outputHighlights(body, [
    { name: 'token', path: 'body.data.token' },
    { name: 'ids', path: 'body.items[*].id' },
    { name: 'first', path: 'body.items[0]' },
    { name: 'gone', path: 'body.nope' },
    { name: 'st', path: 'status' },
    { name: 'bad', path: 'body..x' },
  ]);
  assert.equal(map.get(pathKey(['data', 'token'])), 'token');
  assert.equal(map.get(pathKey(['items', 0, 'id'])), 'ids');
  assert.equal(map.get(pathKey(['items', 1, 'id'])), 'ids');
  assert.equal(map.get(pathKey(['items', 0])), 'first');
  assert.equal(map.size, 4);
});

test('outputHighlights joins names that read the same path', () => {
  const map = outputHighlights({ a: 1 }, [{ name: 'x', path: 'body.a' }, { name: 'y', path: 'body["a"]' }]);
  assert.equal(map.get(pathKey(['a'])), 'x, y');
});

test('newOutputFor names the output after the last key and keeps names unique', () => {
  assert.deepEqual(newOutputFor(['data', 'token'], []), { name: 'token', path: 'body.data.token' });
  assert.deepEqual(newOutputFor(['items', 0, 'id'], [{ name: 'id', path: 'x' }]), { name: 'id2', path: 'body.items[0].id' });
  assert.deepEqual(newOutputFor(['a b'], [{ name: 'a b' }, { name: 'a b2' }]).name, 'a b3');
  assert.deepEqual(newOutputFor([0], []), { name: 'value', path: 'body[0]' });
});

test('outputError checks the name and the path', () => {
  const outs = [{ name: 'token', path: 'body.token' }, { name: 'id', path: 'body.id' }];
  assert.equal(outputError('', 'body.x', outs, -1), 'Name is required');
  assert.equal(outputError('a{b', 'body.x', outs, -1), 'Name can’t contain { or }');
  assert.equal(outputError('token', 'body.x', outs, -1), 'An output named token already exists');
  assert.equal(outputError('token', 'body.x', outs, 0), null);
  assert.match(outputError('x', 'nope', outs, -1), /Path must start/);
  assert.equal(outputError(' x ', 'body.x', outs, -1), null);
});
