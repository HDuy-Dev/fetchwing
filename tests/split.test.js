import test from 'node:test';
import assert from 'node:assert/strict';
import { MIN_RESPONSE, clampSplit } from '../src/lib/split.js';

const box = { work: 600, min: 50, reserved: 8 };

test('keeps a height inside the limits, even above 55%', () => {
  assert.equal(clampSplit(400, box), 400);
});

test('leaves the response at least 120px', () => {
  assert.equal(MIN_RESPONSE, 120);
  assert.equal(clampSplit(999, box), 472);
});

test('keeps the URL bar visible', () => {
  assert.equal(clampSplit(-20, box), 50);
});

test('the minimum wins when the panel is too short for both', () => {
  assert.equal(clampSplit(300, { work: 150, min: 50, reserved: 8 }), 50);
});

test('anything but a finite number means automatic', () => {
  for (const bad of [null, undefined, '300', NaN, Infinity, {}]) assert.equal(clampSplit(bad, box), null);
});
