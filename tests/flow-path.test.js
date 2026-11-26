import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePath, readOutput, toText, pathFor } from '../src/lib/flow-path.js';

const res = (body, extra = {}) => ({ status: 200, headers: [['X-Request-Id', 'abc']], bodyText: JSON.stringify(body), bodyTruncated: false, ...extra });

test('reads body, headers and status', () => {
  const r = res({ data: { token: 't', 'a.b': 1 }, items: [{ id: 7 }, { id: 9 }, {}] });
  assert.deepEqual(readOutput(r, 'body.data.token'), { found: true, value: 't' });
  assert.deepEqual(readOutput(r, 'body.data["a.b"]'), { found: true, value: 1 });
  assert.deepEqual(readOutput(r, 'body.items[1].id'), { found: true, value: 9 });
  assert.deepEqual(readOutput(r, 'body.items[*].id'), { found: true, value: [7, 9] });
  assert.deepEqual(readOutput(r, 'headers.x-request-id'), { found: true, value: 'abc' });
  assert.deepEqual(readOutput(r, 'status'), { found: true, value: 200 });
  assert.deepEqual(readOutput(r, 'body.nope'), { found: false });
});

test('a miss in a truncated body is reported as truncated', () => {
  assert.deepEqual(readOutput({ ...res({}), bodyText: '{"a":', bodyTruncated: true }, 'body.a'), { error: 'truncated' });
});

test('a body that is not JSON is not found', () => {
  assert.deepEqual(readOutput(res({}, { bodyText: '<html>' }), 'body.a'), { found: false });
});

test('toText and pathFor', () => {
  assert.equal(toText('pro'), 'pro');
  assert.equal(toText(42), '42');
  assert.equal(toText(true), 'true');
  assert.equal(toText([7, 9]), '[7,9]');
  assert.equal(toText(null), 'null');
  assert.equal(pathFor(['data', 'token']), 'body.data.token');
  assert.equal(pathFor(['items', 0, 'a.b']), 'body.items[0]["a.b"]');
  assert.equal(parsePath('body..x').ok, false);
});

test('pathFor output parses back to the same keys', () => {
  const p = parsePath(pathFor(['a"b', 2, 'c']));
  assert.deepEqual(p.steps.slice(1), [{ key: 'a"b' }, { index: 2 }, { key: 'c' }]);
});

test('readOutput on non-JSON and JSON bodies for bare body', () => {
  const text = res({}, { bodyText: 'plain text' });
  assert.deepEqual(readOutput(text, 'body'), { found: true, value: 'plain text' });
  assert.deepEqual(readOutput(text, 'body.a'), { found: false });
  assert.deepEqual(readOutput(res({ a: 1 }), 'body'), { found: true, value: { a: 1 } });
});
