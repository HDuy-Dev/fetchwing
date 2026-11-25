# Whole-Body Formatted Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans.

**Goal:** The Body pencil edits the whole mock body formatted, with JSON strings expanded, and packs them back on Done.
**Architecture:** Pure `unpackBody` / `packBody` in `src/lib/json-text.js`, working on a token tree so numbers and untouched strings stay verbatim; `mock-editor.js` reuses its string-edit mode for the body.
**Tech Stack:** Vanilla ES modules, `node --test`.
**Spec:** `docs/superpowers/specs/2026-11-25-nested-json-design.md`, section "Bổ sung: sửa cả body ở dạng đã format".

## Global Constraints
- Done with no change leaves the body identical. Numbers are never re-serialised.
- Outer body: one-line original saves compact, multi-line saves with 2 spaces.
- UI copy: `Editing: body`, `Cancel`, `Done`, `Save anyway`, `Edit`, `The mock body changed while you were editing`.
- Non-JSON bodies keep the autosaving editor. Popup untouched.

## Review Focus
- Renaming `list` or an object between `list[*]` and the packed field: must warn.
- Removing a whole array element: must not warn.
- Pasting a body whose fields are already strings: kept, no double packing, no warning.
- Outside change during a body edit: warns; unchanged text closes and keeps the new body.
- `__proto__` keys and duplicate keys.

### Task 1: unpackBody / packBody
**Interfaces (Produces):** `unpackBody(body): string`; `packBody(body, edited): { error } | { body, warnings: string[] }` (`body` = the text the edit started from; `warnings` are path labels such as `list[*].d`).
- A packed field is matched by its path with array indices wildcarded. All containers at that pattern packed → pack any container there. Mixed → pack by exact path, and warn if the outermost array on the pattern changed at all.
- Missing field: at every step of a packed pattern, count places that cannot take the next step; warn if the edit has more of them than the original.
- Unchanged packed content reuses the original string token; changed content keeps the one-line / multi-line style.
- Tests first in `tests/json-text.test.js` (one per spec bullet and Review Focus line), watch fail, implement, `npm test`, commit `feat: pack and unpack JSON strings across a whole body`.

### Task 2: Mock editor
- Body pencil on an object/array body opens the Done/Cancel mode with `unpackBody`. Done: unchanged text just closes; error shows alert; warnings or an outside body change show the alert plus `Save anyway`; typing hides it.
- `.jedit` becomes a bordered button with icon and the word `Edit`.
- README sentence updated. Browser check in the stubbed harness, light and dark. Commit `feat: edit the whole mock body formatted`.
