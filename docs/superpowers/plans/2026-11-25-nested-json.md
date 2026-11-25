# Nested JSON String View/Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In DevTools, show JSON stored inside a string as a tree (response and mock), and let each such string in a mock body be edited on its own.

**Architecture:** A pure module `src/lib/json-text.js` works on JSON *text* (locate, reformat, replace) so untouched text and big numbers are never re-serialised. `jsonLines()` expands embedded strings and tags them with their path; the viewer draws the tag, and the mock editor passes a callback that opens the single-string editor.

**Tech Stack:** Vanilla ES modules, Chrome MV3, `node --test`. No new dependencies or build step.

**Spec:** `docs/superpowers/specs/2026-11-25-nested-json-design.md`

## Global Constraints

- Only a string that parses to a non-empty object or array is expanded. `"123"`, `"{}"`, `"[]"` and invalid JSON stay plain strings.
- A body that is itself one string stays as today.
- Copy and Raw keep the original data.
- Editing replaces only the edited string; all other body text is unchanged. Done with no change leaves the body identical.
- Number tokens and key order are never rewritten. Original one-line string saves compact; multi-line saves with 2 spaces.
- UI copy is English: tag `JSON string`, button label `Edit JSON string <key>`, header `Editing: <path>`, buttons `Cancel`, `Done`.
- The toolbar popup is not touched.

## Review Focus

- Integers above 2^53 inside the edited string: digits survive open → edit → Done.
- Strings holding `{`, `}`, `"`, `\\` or `:` : the locator must not mistake them for structure.
- Duplicate keys: the last one is replaced, matching `JSON.parse` and the tree.
- A workspace change (sync, popup toggle) while a string is being edited: the typed text stays.
- Done after the body or Content-Type was changed elsewhere: Content-Type edits made in this pane are not lost.

The first three are pinned by tests in Task 1; the last two are checked in the browser in Task 3.

---

### Task 1: JSON text operations

**Files:**
- Create: `src/lib/json-text.js`
- Test: `tests/json-text.test.js`

**Interfaces (Produces):** a *path* is `Array<string | number>` from the body root, running straight through embedded-string layers.
- `parseEmbedded(str): object | null` — the non-empty object/array held by `str`.
- `formatJson(text, indent: 0 | 2): string` — re-whitespaces valid JSON, copying every string and number token verbatim; empty containers stay `{}` / `[]`; indented output matches `JSON.stringify(v, null, 2)` spacing.
- `editorText(body, path): string` — the string at `path`, formatted with indent 2.
- `replaceEmbedded(body, path, edited): { body: string } | { error: string }`
- `pathLabel(path): string`

- [ ] **Step 1: Write the failing tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEmbedded, formatJson, editorText, replaceEmbedded, pathLabel } from '../src/lib/json-text.js';

const wrap = inner => JSON.stringify(inner);

test('only non-empty objects and arrays count as embedded JSON', () => {
  assert.deepEqual(parseEmbedded(' {"a":1}'), { a: 1 });
  assert.deepEqual(parseEmbedded('[1]'), [1]);
  for (const s of ['123', '"x"', 'true', 'null', '{}', '[]', '{a:1}', '', 'hello']) assert.equal(parseEmbedded(s), null, s);
});

test('formatJson keeps tokens verbatim', () => {
  const src = '{"b":12345678901234567890,"a":[1.50,"x { } , : \\" \\\\"],"e":{},"f":[]}';
  const pretty = formatJson(src, 2);
  assert.equal(pretty, '{\n  "b": 12345678901234567890,\n  "a": [\n    1.50,\n    "x { } , : \\" \\\\"\n  ],\n  "e": {},\n  "f": []\n}');
  assert.equal(formatJson(pretty, 0), src);
});

test('replaces only the edited string', () => {
  const body = `{\n "keep" : 99999999999999999999,\n "d": ${wrap('{"price":"12"}')},\n "t":"\\u00e9"}`;
  const text = editorText(body, ['d']);
  assert.equal(text, '{\n  "price": "12"\n}');
  const res = replaceEmbedded(body, ['d'], text.replace('"12"', '"15"'));
  assert.equal(res.body, body.replace(wrap('{"price":"12"}'), wrap('{"price":"15"}')));
});

test('no change leaves the body identical', () => {
  const body = '{"d":"{ \\"a\\" : 1 }"}';
  assert.equal(replaceEmbedded(body, ['d'], editorText(body, ['d'])).body, body);
});

test('multi-line original stays indented', () => {
  const body = wrap({ d: '{\n    "a": 1\n}' });
  const res = replaceEmbedded(body, ['d'], '{"a":2}');
  assert.equal(JSON.parse(res.body).d, '{\n  "a": 2\n}');
});

test('rewraps every layer, through arrays', () => {
  const deep = wrap({ n: 1 });
  const mid = `{"deep":${wrap(deep)},"big":10000000000000000001}`;
  const body = `{"list":[0,{"mid":${wrap(mid)}}]}`;
  const res = replaceEmbedded(body, ['list', 1, 'mid', 'deep'], '{"n":2}');
  const newMid = mid.replace(wrap(deep), wrap(wrap({ n: 2 })));
  assert.equal(res.body, body.replace(wrap(mid), wrap(newMid)));
});

test('big integers inside the edited string survive', () => {
  const body = wrap({ d: '{"id":12345678901234567890,"x":1}' });
  const res = replaceEmbedded(body, ['d'], editorText(body, ['d']).replace('"x": 1', '"x": 2'));
  assert.equal(JSON.parse(res.body).d, '{"id":12345678901234567890,"x":2}');
});

test('duplicate keys: the last one wins', () => {
  const body = `{"d":${wrap('{"a":1}')},"d":${wrap('{"a":2}')}}`;
  assert.equal(editorText(body, ['d']), '{\n  "a": 2\n}');
  assert.equal(replaceEmbedded(body, ['d'], '{"a":3}').body, `{"d":${wrap('{"a":1}')},"d":${wrap('{"a":3}')}}`);
});

test('rejects bad edits', () => {
  const body = wrap({ d: '{"a":1}' });
  for (const bad of ['{"a":', '12', '"x"', 'null', '']) {
    const res = replaceEmbedded(body, ['d'], bad);
    assert.ok(res.error, bad);
    assert.equal(res.body, undefined);
  }
});

test('path labels', () => {
  assert.equal(pathLabel(['product_details']), 'product_details');
  assert.equal(pathLabel(['a', 0, 'phone-4', 'b']), 'a[0]["phone-4"].b');
});
```

- [ ] **Step 2:** `npm test` → FAIL, cannot find `src/lib/json-text.js`.
- [ ] **Step 3:** Implement. The locator is a small scanner over already-valid JSON returning `[start, end)` of the value at a key/index, taking the last duplicate key (keys compared after `JSON.parse` of the key token). `replaceEmbedded` recurses: at a string token with path left, decode it, replace inside the decoded text, re-encode with `JSON.stringify`. At the target: validate `edited` (must parse to a non-null object/array; error text `Invalid JSON: <parser message>` or `Enter a JSON object or array.`), return `body` untouched if `edited === editorText(body, path)`, else encode `formatJson(edited, original.trim().includes('\n') ? 2 : 0)`. A path that doesn't resolve returns `{ error: 'This field is no longer in the body.' }`.
- [ ] **Step 4:** `npm test` → all PASS.
- [ ] **Step 5:** Commit `feat: read and replace JSON held in a string` (include the spec and this plan).

### Task 2: Show embedded JSON in the tree

**Files:**
- Modify: `src/lib/json-lines.js`, `src/panel/json-view.js`, `src/panel/panel.css`
- Test: `tests/json-lines.test.js`

**Interfaces:**
- Consumes: `parseEmbedded`.
- Produces: every line from `jsonLines` has `embedded: Array<string|number> | null`, set only on the `open` line of an expanded string (its path). `renderJsonView(container, value, { toggleButton, onEditString })`, where `onEditString(path)` is optional.

- [ ] **Step 1: Failing tests**

```js
test('expands JSON held in strings and records the path', () => {
  const lines = jsonLines({ list: [{ d: JSON.stringify({ e: '[1]' }) }], n: '123', x: '{}' });
  const embedded = lines.filter(l => l.embedded);
  assert.deepEqual(embedded.map(l => l.embedded), [['list', 0, 'd'], ['list', 0, 'd', 'e']]);
  assert.equal(embedded[0].kind, 'open');
  assert.equal(lines[embedded[0].end].text, '}');
  assert.equal(lines.find(l => l.key === 'n').text, '"123"');
  assert.equal(lines.find(l => l.key === 'x').text, '"{}"');
});

test('a root string is not expanded', () => {
  assert.equal(jsonLines('{"a":1}').length, 1);
});
```

- [ ] **Step 2:** `npm test` → the two new tests fail.
- [ ] **Step 3:** In `walk`, carry the path (array items add their index; `key` stays `null` for them); a non-root string with `parseEmbedded` result is walked as that value, with `embedded` set on its open line. In `json-view.js`, after the bracket (collapsed or not) add `<span class="jtag">JSON string</span>`; when `onEditString` is given, also add a `button.jedit[data-edit=<line index>]` with the `edit` icon (`icon('edit').outerHTML`), `aria-label` and `title` `Edit JSON string <key or index>` (escape quotes for the attribute). The click handler checks `[data-edit]` before `[data-block]`. Style `.jtag` like a small `.hint` chip and `.jedit` like `.more`.
- [ ] **Step 4:** `npm test` → all PASS.
- [ ] **Step 5:** Commit `feat: show JSON held in strings as a tree`.

### Task 3: Edit one string in the mock

**Files:**
- Modify: `src/panel/mock-editor.js`, `src/panel/panel.css`

**Interfaces:** Consumes `editorText`, `replaceEmbedded`, `pathLabel`, `onEditString`.

- [ ] **Step 1:** In `renderMockEditor`, pass `onEditString` to `renderJsonView`. While editing a string (`stringPath !== null`): show the textarea with `editorText(draft.body, path)` and `aria-label` `Editing: <path>`; the bar label reads `Editing: <path>`; hide the fold and edit-body buttons; show `.btn` `Cancel` and `Done`. The textarea `input` listener must not write `draft.body` or save in this mode.
- [ ] **Step 2:** Done: `replaceEmbedded`; on error show it in a `.mock-error[role=alert]` under the bar and stay; on success set `draft.body`, call `save()` then `save.flush()` only if the body changed. Done and Cancel both clear the error, redraw the tree, and focus the matching `[data-edit]` button (fall back to the edit-body button if it is folded away).
- [ ] **Step 3:** The early return at the top of `renderMockEditor` must also apply while a string is being edited and this editor is still in the pane, even if focus is elsewhere, so a workspace change does not throw the typed text away.
- [ ] **Step 4:** `npm test` → all PASS.
- [ ] **Step 5:** Browser check, using a throwaway harness in the scratchpad that serves the repo and calls `renderMockEditor` with a stubbed `chrome` and the sample `product_details` body. Confirm: tree and tags show; edit `price`, Done → saved `product_details` is still a string with the new price; invalid JSON shows the alert and saves nothing; Cancel saves nothing; focus returns to the button; a second render call while editing, with focus outside the pane, keeps the text; a Content-Type change made just before editing is still in the saved patch; the response pane shows tags and no edit buttons; light and dark both readable.
- [ ] **Step 6:** Add to the README "Send from the extension" / "Mocks" bullets one sentence: JSON held in a string opens as a tree, and in a mock each can be edited. Commit `feat: edit JSON held in a mock string`.
