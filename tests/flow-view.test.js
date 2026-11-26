import test from 'node:test';
import assert from 'node:assert/strict';
import { zoomAt, fitView, snap, midEllipsis, edgeLabel, isSensitiveName, isSensitiveHeader } from '../src/lib/flow-view.js';

test('zoomAt keeps the point under the cursor and clamps', () => {
  assert.deepEqual(zoomAt({ x: 0, y: 0, k: 1 }, 2, 100, 100), { x: -100, y: -100, k: 2 });
  assert.equal(zoomAt({ x: 0, y: 0, k: 1 }, 0.01, 0, 0).k, 0.1);
  assert.equal(zoomAt({ x: 0, y: 0, k: 1 }, 99, 0, 0).k, 4);
});

test('fitView', () => {
  assert.deepEqual(fitView([], 800, 600), { x: 0, y: 0, k: 1 });
  const v = fitView([{ x: 0, y: 0, w: 100, h: 100 }], 800, 600);
  assert.equal(v.k, 1.2);
  assert.equal(v.x, (800 - 120) / 2);
  const big = fitView([{ x: 100, y: 0, w: 2000, h: 100 }], 800, 600);
  assert.ok(big.k < 1);
  assert.ok(Math.abs(big.x + 100 * big.k + 1000 * big.k - 400) < 1e-9);
});

test('snap', () => {
  assert.equal(snap(23), 16);
  assert.equal(snap(25), 32);
});

test('midEllipsis', () => {
  const url = '{{base}}/v2/personalisation/carts/{{cartId}}/recommendations';
  const out = midEllipsis(url, 30);
  assert.equal(out.length, 30);
  assert.ok(out.startsWith('{{base}}/v2/'));
  assert.ok(out.endsWith('recommendations'));
  assert.equal(midEllipsis('short', 30), 'short');
});

test('edgeLabel', () => {
  assert.equal(edgeLabel(['token', 'userId', 'a', 'b', 'c']).text, 'token, userId +3');
  assert.equal(edgeLabel(['a', 'b']).text, 'a, b');
  assert.equal(edgeLabel(['a', 'b', 'c']).title, 'a, b, c');
});

test('sensitive names', () => {
  assert.ok(isSensitiveName('apiKey') && isSensitiveName('Password'));
  assert.ok(!isSensitiveName('userId'));
  assert.ok(isSensitiveHeader('Authorization') && isSensitiveHeader('x-api-key') && isSensitiveHeader('Cookie'));
  assert.ok(!isSensitiveHeader('Content-Type'));
});
