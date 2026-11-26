# Split Resize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drag a handle to resize the request part against Response/Mock.

**Architecture:** A pure clamp function in `src/lib/split.js`; a small DOM controller in `src/panel/split.js` that sets `--req-h` and the class `sized` on `#editor`. CSS applies them, and the side-by-side media query overrides them.

**Tech Stack:** Vanilla ES modules, CSS, `node --test`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-26-split-resize-design.md`

## Global Constraints

- Response/Mock keeps at least 120px; the URL bar stays visible.
- One saved height for all requests, through `store` in `panel.js`, key `reqHeight` (stored as `fw.reqHeight`).
- Until the user drags, layout is unchanged (`max-height: 55%`, auto height).
- No handle and no saved height under `@container app (max-height: 440px) and (min-width: 900px)`.
- UI copy is in English.

## Review Focus

- Panel made shorter than the saved height: displayed height shrinks, saved value is kept and comes back when the panel grows (Task 1 test + Task 2 browser check).
- Panel too short to satisfy both limits: the URL bar minimum wins, no negative height (Task 1 test).
- Corrupt or non-numeric `fw.reqHeight`: automatic height (Task 1 test).
- Pointer cancelled or released outside the window: dragging ends (pointer capture; Task 2 browser check).
- Click or double-click on the handle without moving: nothing is saved by the click; double-click clears (Task 2 browser check).

---

### Task 1: Clamp logic

**Files:**
- Create: `src/lib/split.js`
- Test: `tests/split.test.js`

**Interfaces:**
- Produces: `MIN_RESPONSE = 120`; `clampSplit(height: unknown, { work: number, min: number, reserved: number }): number | null`. `work` is the work area height, `min` the smallest request height, `reserved` the handle height. Returns `null` (automatic) when `height` is not a finite number.

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2:** Run `node --test tests/split.test.js`. Expected: FAIL, module not found.
- [ ] **Step 3:** Implement `clampSplit` in `src/lib/split.js`; round the result to a whole pixel.
- [ ] **Step 4:** Run `npm test`. Expected: all pass.
- [ ] **Step 5:** Commit `feat: clamp the request/response split height`.

### Task 2: Handle, wiring and styles

**Files:**
- Create: `src/panel/split.js`
- Modify: `src/panel/panel.html` (between `#editor` and `#bottom`), `src/panel/panel.js` (call once, after `store`), `src/panel/panel.css`

**Interfaces:**
- Consumes: `clampSplit` and `MIN_RESPONSE` from Task 1.
- Produces: `initSplit({ work: HTMLElement, req: HTMLElement, handle: HTMLElement, store: { get(key, fallback), set(key, value) } }): void`.

- [ ] **Step 1: Markup**

```html
<div class="splitter" id="splitter" role="separator" aria-orientation="horizontal" aria-label="Resize request and response" tabindex="0" title="Drag to resize, double-click to reset"></div>
```

- [ ] **Step 2: Controller** in `src/panel/split.js`:
  - `min` is the bottom of `req.querySelector('.urlbar')` measured from the top of `req`'s content (it wraps to two rows when narrow), plus 8px. `reserved` is `handle.offsetHeight`.
  - Apply: clamp the saved value; a number sets `--req-h` (px) on `req` and adds `sized`; `null` removes both. Set `aria-valuenow`, `aria-valuemin`, `aria-valuemax` to the pixel values (current height when automatic). Applying never writes to the store.
  - Drag: primary button only, `setPointerCapture`; new height is the starting `req.offsetHeight` plus the pointer's vertical travel. Save on the first real movement and onwards, so a plain click saves nothing. End on `pointerup`, `pointercancel` and `lostpointercapture`.
  - `dblclick`: save `null`, apply.
  - `keydown`: ArrowUp / ArrowDown move by 16px, `preventDefault`, save.
  - A `ResizeObserver` on `work` re-applies; skip while `work.offsetHeight` is 0 (hidden). Also re-apply on focus of the handle so the aria values are current.

- [ ] **Step 3: Wire** in `panel.js`: `initSplit({ work: $('work'), req: $('editor'), handle: $('splitter'), store });`

- [ ] **Step 4: Styles** in `panel.css`:
  - `.splitter`: 8px tall, `flex-shrink: 0`, `cursor: row-resize`, `touch-action: none`, `background: var(--surface)`, `border-top: 1px solid var(--divider)`, with a centred 32×3px grip in `var(--control)`; hover, `:focus-visible` and an active drag colour the grip `var(--accent-line)`. While dragging, text selection is off.
  - `.resp`: drop `margin-top: 8px` and `border-top` (the handle replaces them; the handle gets `margin-top: 8px`).
  - `.req.sized { height: var(--req-h); max-height: none; flex-shrink: 0; }`
  - In the side-by-side query: `.splitter { display: none; }`, `.work .req.sized { height: auto; flex-shrink: 1; }`, and remove the now-unneeded `margin-top: 0; border-top: 0` from `.work .resp`.

- [ ] **Step 5: Verify in a browser.** Serve the repo over localhost and open `src/panel/panel.html` with a stubbed `chrome` API (stub kept in the scratchpad, not the repo). Check: unchanged layout before dragging; drag both ways to both limits with a long body; the value survives reload; shrinking then growing the viewport restores it; a click saves nothing; double-click resets; arrows work; Response and Mock tabs both resize; at 1000×400 the handle is gone and the columns look as before; both light and dark.

- [ ] **Step 6:** Run `npm test`. Expected: all pass.
- [ ] **Step 7:** Commit `feat: drag to resize the request and response`.
