import test from 'node:test';
import assert from 'node:assert/strict';
import { openDialog, dismissDialog, afterDialog } from '../src/panel/ui.js';

// Just enough DOM for openDialog.
const fakeNode = () => ({
  children: [], hidden: false,
  setAttribute() {}, addEventListener() {}, querySelector: () => null,
  append(...nodes) { this.children.push(...nodes); },
  set textContent(v) { this.children = []; },
});
const keys = new Set();
const backdrop = fakeNode();
backdrop.hidden = true;
backdrop.dispatchEvent = () => backdrop.onmousedown({ target: backdrop });
globalThis.MouseEvent = class {};
globalThis.document = {
  getElementById: () => backdrop,
  createElement: fakeNode,
  addEventListener: (type, fn) => keys.add(fn),
  removeEventListener: (type, fn) => keys.delete(fn),
};
const press = (key, extra = {}) => [...keys].forEach(fn => fn({ key, preventDefault() {}, ...extra }));

test('a guarded dialog stays through Escape, backdrop, dismiss and replacement', () => {
  let asked = 0;
  let close;
  openDialog((box, c) => { close = c; }, { canClose: () => { asked++; return false; } });
  const box = backdrop.children[0];
  press('Escape');
  backdrop.onmousedown({ target: backdrop });
  dismissDialog();
  let built = false;
  assert.equal(openDialog(() => { built = true; }), null);
  assert.equal(asked, 4);
  assert.equal(built, false);
  assert.equal(backdrop.children[0], box);
  close();
  assert.equal(backdrop.hidden, true);
  assert.equal(keys.size, 0);
});

test('replacing a dialog closes it and leaves one key listener', () => {
  let closed = 0;
  const first = openDialog(() => {}, { onClosed: () => closed++ });
  openDialog(() => {});
  assert.equal(closed, 1);
  assert.equal(keys.size, 1);
  first();
  assert.equal(backdrop.hidden, false, 'an old close must not close the new dialog');
  press('Escape');
  assert.equal(backdrop.hidden, true);
  assert.equal(keys.size, 0);
});

test('keys pressed while composing are ignored', () => {
  const close = openDialog(() => {});
  press('Escape', { isComposing: true });
  press('Escape', { keyCode: 229 });
  assert.equal(backdrop.hidden, false);
  close();
});

test('afterDialog waits for the open dialog to close, or runs at once', () => {
  let ran = 0;
  afterDialog(() => ran++);
  assert.equal(ran, 1);
  const close = openDialog(() => {});
  afterDialog(() => ran++);
  assert.equal(ran, 1);
  close();
  assert.equal(ran, 2);
});
