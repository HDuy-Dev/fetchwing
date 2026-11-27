# Env Value Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Edit large, multi-line environment variable values in a dialog, with a one-line summary in the variable table.

**Architecture:** All decisions that can be pure live in `src/lib/env-value.js` and are tested with `node:test`. `src/panel/value-dialog.js` draws the dialog and saves through the existing `updateEnvironment` mutation against the *latest* workspace, so it keeps working if the env tab is redrawn or closed. `env-view.js` only decides input vs. summary and opens the dialog.

**Tech Stack:** Plain ES modules, DOM, Chrome extension (DevTools panel). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-27-env-value-dialog-design.md` (mockup: `mockup/env-value.html`; its syntax colours in the edit box are illustrative only).

## Global Constraints

- Never lose typed text; never change a value that was only opened; never reveal or sync a secret. "Show value" does not change the `secret` flag.
- No change to the data model, sync, or `{{name}}` substitution.
- No editor syntax highlighting; no unpacking of nested JSON strings in the edit box.
- UI copy is English. Styles use only the tokens in `src/panel/panel.css`; dark, light and narrow panel all work.
- Work on branch `feat/env-value-dialog`. First commit: the spec, the mockup and this plan.

## Review Focus

1. Pasting a single-line token that ends with a newline (copied from a terminal) → stays an inline value, no summary row.
2. Another dialog is requested, or `dismissDialog()` runs (popup "reveal"), while the draft is dirty → the draft stays; the discard question is shown.
3. Sync reorders or removes variables while the dialog is open → Save never writes into a different variable.
4. CRLF text pasted → stored with `\n` only.
5. Opening a minified JSON value and pressing Save untouched → byte-identical value, big numbers included.

---

### Task 1: Pure logic

**Files:**
- Create: `src/lib/env-value.js`, `tests/env-value.test.js`

**Interfaces:**
- Consumes: `formatJson(text, indent)`, `parseEmbedded(str)` from `src/lib/json-text.js`.
- Produces:
  - `isLargeValue(value: string): boolean`
  - `valueSummary(value: string, secret: boolean): { kind: 'JSON'|'Text', size: string, preview: string }`
  - `pastedValue(current, start, end, pasted): string | null` (`null` = let the browser paste)
  - `jsonState(text): null | { valid: true } | { valid: false, message: string }`
  - `openText(value): string`
  - `savedText(original, edited): string`
  - `hasUnsafeNumber(text): boolean`
  - `indentAt(text, caret): string` (leading spaces/tabs of the caret's line, up to the caret)
  - `findVar(vars, { key, index }): number` (-1 when it can't be told apart)
  - `saveCheck(base: string, current: string | null, forced: boolean): 'ok' | 'changed' | 'gone'`

- [ ] **Step 1: Write the failing tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { isLargeValue, valueSummary, pastedValue, jsonState, openText, savedText, hasUnsafeNumber, indentAt, findVar, saveCheck } from '../src/lib/env-value.js';

test('isLargeValue: line breaks or a non-empty JSON object/array', () => {
  for (const s of ['a\nb', '{"a":1}', ' [1]']) assert.equal(isLargeValue(s), true, s);
  for (const s of ['', 'abc', '{}', '[]', '{oops', '{{host}}', '42', 'x'.repeat(500)]) assert.equal(isLargeValue(s), false, s);
});

test('valueSummary: lines when more than one, otherwise keys or items', () => {
  assert.deepEqual(valueSummary('{\n "a": 1\n}', false), { kind: 'JSON', size: '3 lines', preview: '{ "a": 1 }' });
  assert.equal(valueSummary('{"a":1}', false).size, '1 key');
  assert.equal(valueSummary('[1,2]', false).size, '2 items');
  assert.equal(valueSummary('a\r\nb', false).kind, 'Text');
  assert.equal(valueSummary('a'.repeat(200) + '\nb', false).preview.length, 80);
  assert.equal(valueSummary('top\nsecret', true).preview, '••••••••');
});

test('pastedValue only takes over for text with inner line breaks', () => {
  assert.equal(pastedValue('', 0, 0, 'token\n'), null);
  assert.equal(pastedValue('', 0, 0, 'token\r\n'), null);
  assert.equal(pastedValue('', 0, 0, 'a\r\nb\r\n'), 'a\nb\n');
  assert.equal(pastedValue('xxYY', 2, 4, '1\n2'), 'xx1\n2');
});

test('jsonState reports only text that looks like JSON, with line and column', () => {
  assert.equal(jsonState('hello'), null);
  assert.deepEqual(jsonState(' {"a":1}'), { valid: true });
  const bad = jsonState('{\n  "a": 1,\n}');
  assert.equal(bad.valid, false);
  assert.match(bad.message, /^Line 3, column 1: /);
  assert.doesNotMatch(bad.message, /position/);
  assert.equal(jsonState('{"a": x}').valid, false);
});

test('openText formats only one-line JSON objects and arrays', () => {
  assert.equal(openText('{"a":1}'), '{\n  "a": 1\n}');
  assert.equal(openText('{ "a":1,\n"b":2 }'), '{ "a":1,\n"b":2 }');
  assert.equal(openText('plain'), 'plain');
  assert.equal(openText('{oops'), '{oops');
});

test('savedText keeps an untouched value and packs edited one-line JSON', () => {
  const big = '{"id":12345678901234567890, "s":"\\u0041"}';
  assert.equal(savedText(big, openText(big)), big);
  assert.equal(savedText('{"a":1}', '{\n  "a": 2\n}'), '{"a":2}');
  assert.equal(savedText('{"a":1}', '{\n  "a": \n}'), '{\n  "a": \n}');
  assert.equal(savedText('{\n"a":1}', '{\n"a":2}'), '{\n"a":2}');
  assert.equal(savedText('abc', 'a\nb'), 'a\nb');
  assert.equal(savedText('', '{\n}'), '{\n}');
});

test('hasUnsafeNumber looks at numbers, also inside JSON strings, not at plain strings', () => {
  assert.equal(hasUnsafeNumber('{"id":12345678901234567890}'), true);
  assert.equal(hasUnsafeNumber('{"p":"{\\"id\\":12345678901234567890}"}'), true);
  assert.equal(hasUnsafeNumber('{"id":"12345678901234567890","x":1.5}'), false);
});

test('indentAt repeats the current line indent', () => {
  assert.equal(indentAt('{\n    "a": 1', 12), '    ');
  assert.equal(indentAt('    x', 2), '  ');
  assert.equal(indentAt('x', 1), '');
});

test('findVar never returns a different variable', () => {
  const vars = [{ key: 'a' }, { key: 'b' }, { key: 'd' }, { key: 'd' }];
  assert.equal(findVar(vars, { key: 'b', index: 1 }), 1);
  assert.equal(findVar(vars, { key: 'b', index: 0 }), 1);
  assert.equal(findVar(vars, { key: 'z', index: 0 }), -1);
  assert.equal(findVar(vars, { key: 'd', index: 0 }), -1);
  assert.equal(findVar(vars, { key: '', index: 0 }), -1);
});

test('saveCheck', () => {
  assert.equal(saveCheck('a', 'a', false), 'ok');
  assert.equal(saveCheck('a', 'b', false), 'changed');
  assert.equal(saveCheck('a', 'b', true), 'ok');
  assert.equal(saveCheck('a', null, true), 'gone');
});
```

- [ ] **Step 2:** `npm test` → fails: cannot find `src/lib/env-value.js`.
- [ ] **Step 3: Implement the interfaces.**
  - `pastedValue`: acts only if `pasted.trimEnd()` contains a line break; normalises `\r\n?` to `\n` in the pasted part.
  - `jsonState`: "looks like JSON" = `/^\s*[[{]/`. When the engine message has `position N`, prefix `Line L, column C: ` computed from `text` and cut from ` in JSON at position` onward; otherwise use the engine message as is.
  - `savedText`: untouched (`edited === openText(original)`) → `original`; else if `original` has no `\n`, is large, and `edited` parses → `formatJson(edited, 0)`; else `edited`.
  - `hasUnsafeNumber`: walk string and number tokens; a number is unsafe when it is an integer literal outside `Number.isSafeInteger`, or has more than 17 significant digits; recurse into strings accepted by `parseEmbedded`.
- [ ] **Step 4:** `npm test` → all pass.
- [ ] **Step 5:** Commit `feat: add logic for editing large environment values`.

---

### Task 2: A dialog that can refuse to close

**Files:**
- Modify: `src/panel/ui.js` (`openDialog`, `dismissDialog`)

**Interfaces:**
- Produces: `openDialog(build, { className = 'dialog', canClose, onClosed } = {}): close | null`
  - `canClose(): boolean` is asked on Esc, backdrop press, `dismissDialog()`, and when another `openDialog` call wants to replace this one. `false` → nothing closes, the new dialog is not built, `openDialog` returns `null`; `canClose` itself shows the discard question.
  - The `close` passed to `build` always closes (no guard). `onClosed()` runs after any close.
  - Keys with `e.isComposing || e.keyCode === 229` are ignored.
- Existing callers pass neither option and behave as before.

- [ ] **Step 1:** Implement. Keep one module-level "current dialog" record; close it properly before opening the next, which also removes its `keydown` listener (today a replaced dialog leaks it).
- [ ] **Step 2:** The sync-account confirm in `panel.js` (`confirmAccountDialog`) can now be refused by a dirty draft: when `openDialog` returns `null`, remember the arguments and open it from the draft's `onClosed` (export `afterDialog(fn)` from `ui.js`: runs `fn` once the current dialog closes).
- [ ] **Step 3:** `npm test` → all pass.
- [ ] **Step 4:** Commit `feat: let a dialog guard against closing`.

---

### Task 3: The value dialog and the table

**Files:**
- Create: `src/panel/value-dialog.js`
- Modify: `src/panel/env-view.js`, `src/panel/ui.js` (icon `maximize`), `src/panel/panel.css` (environment tab section and the 440px/560px container blocks)

**Interfaces:**
- Consumes: everything from Tasks 1 and 2; `renderJsonView(container, value)` and `parseJson(text)` from `json-view.js`.
- Produces: `openValueDialog({ title, envName, value, secret, current, save, onClosed })`
  - `current(): string | null` — the saved value now, `null` if the variable or env is gone.
  - `save(text): Promise<boolean>` — `false` keeps the dialog open with the draft.

- [ ] **Step 1: `value-dialog.js`**, per spec sections "Hộp thoại" and "Secret". Exact copy:
  - Title `<key>` + `· <env name>`; the dialog is `aria-labelledby` it. An empty key shows `Value`.
  - Toolbar: `Edit`, `Tree` (`aria-pressed`), `✓ Valid JSON` / `✕ Invalid JSON`, `Format` (enabled only when valid; applies `formatJson(text, 2)` with `document.execCommand('insertText')` over a full selection so undo works).
  - Under the editor (`role="status"`, redrawn 300 ms after typing stops): `<message> You can still save.`
  - Tree notice when `hasUnsafeNumber`: `Large numbers are rounded here. Edit shows the exact text.`
  - Footer: hint `⌘ Enter to save` (`Ctrl+Enter to save` off macOS), `Cancel`, `Save`.
  - Discard question replaces the footer: `Discard changes?`, `Keep editing` (focused), `Discard`; Esc here = keep editing. Dirty = `textarea.value !== openText(value)`.
  - Secret: `This value is secret and hidden.` + `Show value` (focused); Edit/Tree/Format disabled; footer only `Close`. The textarea gets the value only after `Show value`.
  - Save: `saveCheck(value, current(), forced)`. `changed` → `The value changed while you were editing. Saving replaces it.` and the button reads `Save anyway`. `gone` → `This variable no longer exists. Copy your text before closing.`, not saved. `ok` → `await save(savedText(value, textarea.value))`; `true` closes. Ignore a second Save while one is running.
  - Keyboard: focus the textarea, caret and scroll at the start; Tab is trapped inside the dialog but not hijacked in the textarea; Enter inserts `'\n' + indentAt(...)` via `execCommand('insertText')`; ⌘/Ctrl+Enter saves; all ignored while composing.
- [ ] **Step 2: `env-view.js` rows.**
  - Value cell is a `button.env-chip` (`aria-label="Edit value of <key>"`) when `isLargeValue(v.value)` at render time, else the input. Never swap while the user is typing in the input.
  - Chip text: `kind`, `size`, `preview`; the preview is the only part that shrinks. Toggling the lock redraws it.
  - Input rows get `iconButton('maximize', 'Open in editor', …)` first in the actions, class `env-hover` (visible on row hover/focus-within and with `hover: none`), hidden while both key and value are empty. Chip rows and the blank row keep an empty 28px slot. Third grid column becomes `88px`.
  - `paste` on the input: if `pastedValue(...)` is not `null`, `preventDefault()`, apply it through the row's `edit` (so a blank row becomes a variable), swap in the chip and focus it.
- [ ] **Step 3: Opening and saving.** `await flush()`, take `{ key, index }` from the saved vars, then:
  - `current()` = `findVar` on `getWs().environments[envId]` as it is now (`null` if the env is deleted or -1).
  - `save(text)` = `mutate({ type: 'updateEnvironment', id: envId, patch: { vars } })` with the latest saved vars and only that value replaced; returns `Boolean(res?.ok)`.
  - Neither depends on this view still being mounted.
  - `onClosed` focuses that row's chip or its open button, if still connected.
- [ ] **Step 4: CSS.** Classes follow the mockup. `.dialog.value-dialog`: height `80vh`, `overflow: hidden`, editor `flex: 1; min-height: 0`; override `.dialog textarea`'s `min-height: 160px` and border. `@media (max-height: 440px)`: backdrop top padding 0, dialog `height: calc(100vh - 8px)`, padding 8px, hint hidden. The two discard buttons are wrapped together.
- [ ] **Step 5:** `npm test` → all pass.
- [ ] **Step 6: Verify in a real browser.** Serve the repo and load `src/panel/panel.html` with a scratch-directory harness that stubs `chrome` and answers `mutate` with the real functions in `src/lib/model.js` (nothing added to the repo). Check, in dark and light, at 380px and 900px wide, and at 300px high:
  - the five Review Focus cases;
  - paste multi-line into the blank row → summary row, focus on it, line breaks stored;
  - open → focus in the textarea; Tab cycles inside the dialog; Enter keeps indent; ⌘Z undoes Enter and Format;
  - Esc clean closes, Esc dirty asks, Esc again returns; focus lands back on the row;
  - secret: nothing of the value in the DOM before `Show value`; the flag is unchanged after saving;
  - delete the env while the dialog is open → text stays, Save reports it.
- [ ] **Step 7:** Commit `feat: edit large environment values in a dialog`.
