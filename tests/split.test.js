import test from 'node:test';
import assert from 'node:assert/strict';
import { MIN_RESPONSE, clampSplit } from '../src/lib/split.js';
import { initSplit } from '../src/panel/split.js';

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

test('a click that jitters by a pixel or two saves nothing, a real drag does', t => {
  globalThis.ResizeObserver = class { observe() {} };
  globalThis.getComputedStyle = () => ({ marginTop: '8px' });
  t.after(() => { delete globalThis.ResizeObserver; delete globalThis.getComputedStyle; });
  const on = {};
  const handle = { offsetHeight: 8, addEventListener: (type, fn) => { on[type] = fn; }, setPointerCapture() {}, setAttribute() {}, classList: { add() {}, remove() {} } };
  const req = { offsetHeight: 300, scrollTop: 0, querySelector: () => null, classList: { toggle() {} }, style: { setProperty() {}, removeProperty() {} } };
  const saved = [];
  initSplit({ work: { offsetHeight: 600, clientHeight: 600 }, req, handle, store: { get: (k, d) => saved.at(-1) ?? d, set: (k, v) => saved.push(v) } });

  let focused = false;
  handle.focus = () => { focused = true; };
  on.pointerdown({ button: 0, pointerId: 1, clientY: 400, preventDefault() {} });
  assert.equal(focused, true, 'a click focuses the handle so the arrow keys work');
  on.pointermove({ clientY: 401 });
  on.pointermove({ clientY: 397.5 });
  assert.deepEqual(saved, []);

  on.pointermove({ clientY: 350 });
  assert.deepEqual(saved, [250]);
  on.pointermove({ clientY: 399 });
  assert.deepEqual(saved, [250, 299]);
});
