# Fetchwing Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved v3 design (`mockup/redesign-v3.html`) in the real DevTools panel, with the features it introduced: open-request tabs, quick search (⌘K), Mocks section with Pause all, Import cURL file, collapsible JSON viewer for response and mock body, cancel/retry states.

**Architecture:** Keep the worker, storage keys, messages and page mock runtime from the core plan. Pure additions go in `src/lib/` with node tests (`json-lines.js`, `curl.js` split, model `disableAllMocks`, `send.js` abort). The panel is restyled from the mockup: tokens + container queries in `panel.css`, shell in `panel.html`, and the existing view modules are reworked; open tabs, sidebar section and fold state are per-panel UI state in `localStorage`.

**Tech Stack:** unchanged (plain ES modules, MV3, `node --test`, Playwright Chromium e2e).

**Spec:** `docs/superpowers/specs/2026-10-29-fetchwing-design.md` + approved mockup `mockup/redesign-v3.html` (visual source of truth: palette A Teal, dark/light from DevTools theme, icons with tooltips instead of text, small red dot for mocks, thin scrollbars, collapsible JSON with a Collapse all ⇄ Expand all toggle).

## Global Constraints

- Every icon-only control has `aria-label` and `title`. Mock state = 7px dot with `title="Mock on"` / `aria-label`.
- Colors only through CSS tokens copied from the mockup (dark + light teal); light theme uses `#0f766e` for fills/accent text.
- Container queries: ≤760px wide → sidebar becomes a drawer (☰ in rail), search box hidden; ≤560px → Send wraps under URL; ≤440px tall and ≥900px wide → request and response side by side.
- No new permissions, no new storage keys besides `fw.*` localStorage UI state.

## Review Focus

1. Closing the active tab / deleting an open request must leave a valid selection (neighbour tab or empty state). (Task 4 e2e.)
2. Cancel during a send must abort the fetch and remove the cookie DNR rule. (Task 1 test `abort removes the cookie rule`.)
3. Importing a file with several cURL commands, one invalid — valid ones are created, the invalid one reported. (Task 1 test `splits several commands`; Task 4 e2e.)
4. Very large JSON (thousands of lines) must not freeze the panel — viewer renders folded beyond 2000 lines. (Task 2 test `folds deep when large`.)
5. Pause all turns every mock off in one write (badge 0, pages unmocked). (Task 1 test; Task 5 e2e.)

---

### Task 1: Pure additions

**Files:** `src/lib/curl.js`, `src/lib/model.js`, `src/lib/send.js`, `src/background.js`; tests.

- `splitCurlCommands(text): string[]` — split on lines starting with `curl ` (bash continuations and cmd `^` kept with their command); ignores blank/comment (`#`) lines.
- Mutation `{ type: 'disableAllMocks' }` — every live request with `mock.enabled` → false, touched records only.
- `executeSend({ …, signal })` passes `signal` to fetch; abort still removes the DNR rule (finally). Worker keeps `AbortController` per requestId; message `cancelSend {requestId}` → `{ok}`; aborted send returns `{ ok:false, error:'Cancelled', cancelled:true }`.

Tests: `splits several commands`, `keeps continuation lines`, `disableAllMocks turns all off`, `abort removes the cookie rule`.

### Task 2: JSON line model

**Files:** `src/lib/json-lines.js`, `tests/json-lines.test.js`

- `jsonLines(value): Line[]` where `Line = { depth, key|null, kind: 'open'|'close'|'value', text, comma, block: id|null, end: index|null, size: n|null }` — `open` lines carry `block` id and `end` (index of matching close) and `size` (items/keys count). Pure; DOM rendering in the panel uses it.
- `initialCollapsed(lines, { maxVisible = 2000 })` → Set of block ids collapsed so that visible lines ≤ maxVisible (collapse deepest-first blocks below depth 1, then depth 1).

Tests: `lines for nested object`, `open line knows its end and size`, `empty containers are single value lines`, `folds deep when large`.

### Task 3: Panel shell + styles

**Files:** rewrite `src/panel/panel.html`, `src/panel/panel.css` from the mockup; `src/panel/ui.js` gains `icon(name)` (inline SVG set used by the mockup).

Shell: top bar (logo, search box, mocks chip `⇄ N` with menu: list + Pause all, env select `{ } name`, settings), rail (☰ drawer toggle, Collections, Environments, Mocks with dot), sidebar (section title + icon actions), open-tabs row, request area, response/mock area. DevTools theme → `data-mode`.

### Task 4: Collections, tabs, search, import, request editor

**Files:** `src/panel/panel.js`, `tree.js`, `request-editor.js`, new `tabs.js`, `search.js`.

- Sidebar sections: Collections (tree; header icons Paste cURL, Import file, New ▾), Environments (list; click → environment dialog; + add), Mocks (enabled mocks with switch each + Pause all).
- Open tabs: open on select; method + name + mock dot + pending-save ring; close (×, middle-click); persisted `fw.tabs`; deleted requests drop out.
- ⌘K / Ctrl+K and the search box: overlay list filtered by name / URL / method; ↑↓ Enter opens; Esc closes.
- Import file: hidden `<input type=file accept=".txt,.sh,.curl,text/plain">` → `splitCurlCommands` → create each in the selected container; toast "Imported N, skipped M".
- Request editor: kv table with checkbox column (Params/Headers/form bodies), tab counts, Send (title ⌘↵), sending state → Cancel, missing var dashed + inline "name undefined [+]" (opens env dialog).

### Task 5: Response + Mock panes

**Files:** `response-view.js`, `mock-editor.js`, new `json-view.js`.

- `renderJsonView(el, value, { onToggle })` from `jsonLines`: gutter line numbers, fold arrows, `… N items` placeholders, Collapse all ⇄ Expand all toggle synced with manual folds; non-JSON → raw `<pre>`.
- Response: status pill, time, size, Body/Headers segment, icons Pretty/Raw/Copy/Mock this, Collapse toggle; error box with Retry; sending spinner with elapsed time.
- Mock: switch + "Mock on" + site; Status/Delay/Content-Type fields; body box with Collapse toggle + Edit (pencil) toggling a textarea (saves on input).

### Task 6: End-to-end + screenshots

Update the scratchpad e2e to the new selectors; add checks for tabs, search, import, Pause all, cancel, JSON folding, narrow/short layouts. `npm test` green; no page errors.
