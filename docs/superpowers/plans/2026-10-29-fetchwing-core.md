# Fetchwing Core Implementation Plan (plan 1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working Fetchwing extension in one browser: DevTools tab with collections, Paste cURL, sending requests, environments, and response mocks injected into web pages — without Google sync (plan 2).

**Architecture:** Background service worker is the only writer of workspace data (`chrome.storage.local`, key `workspace`) and does all network sends. The DevTools panel page renders the UI and talks to the worker via messages. Pure modules in `src/lib/` (cURL parsing, variables, URL matching, workspace mutations, mock runtime) carry the logic and are unit-tested with `node --test`. Mocks: the worker derives a flat `activeMocks` list and registers two content scripts for granted sites — an isolated-world bridge that reads `activeMocks` from storage and a main-world script that patches `fetch`/`XMLHttpRequest`.

**Tech Stack:** Plain JavaScript ES modules, Chrome MV3 (`devtools_page`, `scripting`, `declarativeNetRequest`, optional host permissions), `node --test` (Node ≥ 20), Playwright Chromium for end-to-end checks.

**Spec:** `docs/superpowers/specs/2026-10-29-fetchwing-design.md`

## Global Constraints

- MV3, Chromium browsers, no build step, no npm runtime dependencies. UI text English.
- Install-time permissions: `storage`, `scripting`, `declarativeNetRequestWithHostAccess`, `clipboardRead`. `optional_host_permissions: ["http://*/*", "https://*/*"]`. No host permission at install.
- Host permission is requested per origin, from a user gesture in the panel: the API origin before the first Send to it; the inspected page origin before enabling the first mock there.
- Mock match = method + full URL including query; query parameter order ignored; `{{vars}}` resolved with the active environment at match time.
- Mocks keep working with DevTools closed, only on granted pages.
- Badge on the extension icon = number of enabled mocks (empty when 0).
- Two enabled mocks with the same match key are not allowed: error `"Another mock for this request is already on: <name>"`.
- Secret environment variables are flagged `secret: true` (plan 2 keeps them out of Drive).
- Response bodies are not persisted; only mock bodies are stored.
- No Postman names, logos or copied UI.

## Review Focus

1. **Requests fired before mocks load** (page scripts at document start) — the main-world script must hold matching-sensitive calls until the bridge delivers the mock list (max 300 ms), then mock or pass through. (Task 4 test `waits for mocks before deciding`.)
2. **cURL from Windows "Copy as cURL (cmd)"** with `^"` escaping and `^` line continuations — must parse the same as bash. (Task 1 test `parses cmd form`.)
3. **Mocked XHR used by libraries** (axios reads `responseText`, `status`, `getAllResponseHeaders`, `onreadystatechange`, `onload`) — fake XHR must behave like a real one. (Task 4 test `mocked XHR behaves like real one`.)
4. **Unmocked traffic untouched** — non-matching fetch/XHR must call the original implementation with the same arguments, including `Request` objects and `AbortSignal`. (Task 4 test `passes through non-matching requests`.)
5. **Cookie header from cURL** — browsers forbid setting `Cookie` via fetch; the send must still carry it (temporary DNR session rule) and clean the rule up afterwards. (Task 5 test `cookie becomes a session rule and is removed`.)

---

## File Structure

```
manifest.json
package.json                       # {"type":"module","scripts":{"test":"node --test \"tests/*.test.js\""}}
src/
  devtools.html, devtools.js       # creates the "Fetchwing" panel
  background.js                    # worker: queue, messages, send, mocks registration, badge
  lib/
    curl.js                        # parseCurl
    vars.js                        # resolveVars, resolveRequest
    match.js                       # normalizeUrl, matchKey
    model.js                       # workspace shape + applyMutation + selectors
    mocks.js                       # deriveActiveMocks, findDuplicate
    send.js                        # buildSend (pure), executeSend (deps injected)
    mock-runtime.js                # installMockRuntime(win, opts) — pure-ish, testable in node
  content/
    mock-bridge.js                 # ISOLATED world: storage -> postMessage
    mock-main.js                   # MAIN world: imports nothing; inlines mock-runtime via build-free copy (see Task 4)
  panel/
    panel.html, panel.css, panel.js
    tree.js, request-editor.js, response-view.js, mock-editor.js, env-editor.js, settings-view.js
tests/
  curl.test.js vars.test.js match.test.js model.test.js mocks.test.js send.test.js mock-runtime.test.js
```

### Shared shapes

```js
// Item: { id, type: 'collection'|'folder'|'request', parentId: string|null, order: number,
//         name: string, updatedAt: number, deleted: boolean, ...requestFields }
// requestFields (type 'request'): { method, url, headers: [{key, value, enabled}], body: Body, mock: Mock }
// Body: { mode: 'none'|'json'|'text'|'urlencoded'|'formdata', raw: string, fields: [{key, value, enabled}] }
// Mock: { enabled: boolean, status: number, headers: [{key, value}], body: string, delayMs: number }
// Environment: { id, name, order, vars: [{key, value, secret}], updatedAt, deleted }
// Workspace: { items: {[id]: Item}, environments: {[id]: Environment}, activeEnvId: string|null }
// ActiveMock (storage key 'activeMocks'): { key, method, url, status, headers, body, delayMs, requestId }
// storage keys: 'workspace', 'activeMocks', 'mockSites' (string[] of origins)
```

Messages panel → worker (`chrome.runtime.sendMessage`):
`getWorkspace` → `{ workspace, mockSites }` · `mutate {mutation}` → `{ok}|{ok:false,error}` · `send {requestId}` → `{ok, response}|{ok:false,error}` · `addMockSite {origin}` / `removeMockSite {origin}` → `{ok}`
Response: `{ status, statusText, timeMs, sizeBytes, headers: [[k,v]], bodyText, bodyTruncated }`

---

### Task 1: Scaffold + cURL parser

**Files:** Create `manifest.json`, `package.json`, `src/lib/curl.js`, `tests/curl.test.js`

**Interfaces — Produces:** `parseCurl(text: string): { method, url, headers: [{key,value,enabled:true}], body: Body, cookie: string|null, warnings: string[] } | { error: string }`
- Tokenizer handles bash (`'…'`, `"…"` with `\` escapes, `$'…'` ANSI-C, `\` line continuation) and cmd (`^` escape, `^"`, `^` + newline continuation, `"…"`).
- Flags: `-X/--request`, `-H/--header`, `-b/--cookie`, `-d/--data/--data-raw/--data-binary/--data-ascii` (join multiple with `&`), `--data-urlencode`, `-F/--form`, `-u/--user` (→ `Authorization: Basic …`), `-G/--get` (data → query), `-A/--user-agent`, `-e/--referer`; ignored with no warning: `--compressed`, `-s`, `-L`, `-k`, `--insecure`, `-i`; unknown flags → `warnings`.
- Method default: `POST` if body present else `GET`. Body mode: `json` if `Content-Type` contains `json` or body parses as JSON object/array; `urlencoded` for `-d` with form content type or `key=value&…`; `formdata` for `-F`; else `text`.
- `manifest.json`: name "Fetchwing", version "0.1.0", `devtools_page: "src/devtools.html"`, background module worker, permissions and optional host permissions per Global Constraints.

- [ ] **Step 1: Tests** — `parses Chrome bash copy` (real-looking multi-line `curl 'https://api.example.com/v1/users?page=2&size=10' -H 'accept: application/json' -H 'authorization: Bearer abc' -b 'sid=1; theme=dark' --data-raw '{"name":"A"}'` → POST, url, 2 headers, cookie `sid=1; theme=dark`, body json raw); `parses cmd form` (same request in `^"` form with `^` continuations → identical result); `defaults to GET without body`; `-X overrides method`; `-u becomes basic auth`; `-G moves data to query`; `form fields from -F`; `urlencoded body`; `$'…' strings decode \n and \'`; `unknown flags produce warnings`; `not a curl command` → `{ error: 'Not a cURL command' }`; `missing URL` → `{ error: 'No URL found' }`.
- [ ] **Step 2:** `npm test` → FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** `git init` done already; commit `feat: add cURL parser`.

### Task 2: Variables + URL matching

**Files:** Create `src/lib/vars.js`, `src/lib/match.js`, tests.

**Interfaces — Produces:**
- `resolveVars(text, vars: {[key]: string}): { value: string, missing: string[] }` — `{{ name }}` (trim inside braces); unknown left as-is and listed in `missing` (deduped).
- `envVars(workspace): {[key]: string}` — active environment's vars (later keys win).
- `resolveRequest(request, vars): { method, url, headers: [[k,v]], body: Body, missing: string[] }` — resolves URL, enabled headers, body raw and fields.
- `normalizeUrl(url): string` — lowercase scheme/host, drop default port (80/443), drop fragment, keep path case, sort query params by key then value (stable), keep repeated keys, `?` removed when no params. Invalid URL → returned trimmed as-is.
- `matchKey(method, url): string` — `METHOD␠normalizedUrl` with method uppercased.

- [ ] **Step 1: Tests** — `replaces variables`, `reports missing once`, `resolveRequest skips disabled headers`, `normalizeUrl sorts query`, `normalizeUrl drops default port and fragment`, `matchKey ignores query order`, `matchKey distinguishes different query values`, `matchKey distinguishes methods`.
- [ ] **Steps 2–5:** FAIL → implement → PASS → commit `feat: add variables and URL matching`.

### Task 3: Workspace model

**Files:** Create `src/lib/model.js`, `tests/model.test.js`

**Interfaces — Produces:**
- `emptyWorkspace(): Workspace` — one collection "My Collection", one environment "Local" (no vars), `activeEnvId` = that env.
- `newRequest(fields?): requestFields` — defaults `GET`, empty url, no headers, body `{mode:'none',raw:'',fields:[]}`, mock `{enabled:false,status:200,headers:[],body:'',delayMs:0}`.
- `applyMutation(ws, m, now): { workspace } | { error }` — pure, new objects, sets `updatedAt = now` on touched records. Mutations:
  `addItem {id,type,parentId,name,fields?}` (collections have `parentId: null`; folders/requests need a live parent that is a collection or folder; order = last+1) ·
  `updateRequest {id, patch}` (method/url/headers/body/name) ·
  `renameItem {id,name}` (trim; empty → `empty_name`) ·
  `moveItem {id,parentId,order}` (reject moving into itself/descendant → `invalid_move`; reorders siblings) ·
  `deleteItem {id}` (tombstones the subtree) ·
  `updateMock {id, patch}` (status/headers/body/delayMs) ·
  `setMockEnabled {id, enabled}` ·
  `addEnvironment {id,name}` · `updateEnvironment {id, patch: {name?, vars?}}` · `deleteEnvironment {id}` (if active, activeEnvId → first live env or null) · `setActiveEnv {id}`.
- Selectors: `children(ws, parentId)` (live, by order), `liveRequests(ws)`, `pathOf(ws, id): string[]` (names root→item).

- [ ] **Step 1: Tests** — `empty workspace has a collection and Local env`, `adds folder and request under collection`, `rejects request under a request`, `moveItem reorders siblings`, `moveItem rejects moving into descendant`, `deleteItem tombstones subtree`, `updateRequest touches updatedAt`, `deleting active env picks another`, `applyMutation does not mutate input`.
- [ ] **Steps 2–5:** FAIL → implement → PASS → commit `feat: add workspace model`.

### Task 4: Mock runtime (page side) + derivation

**Files:** Create `src/lib/mocks.js`, `src/lib/mock-runtime.js`, `src/content/mock-bridge.js`, `src/content/mock-main.js`, tests `mocks.test.js`, `mock-runtime.test.js`

**Interfaces — Produces:**
- `deriveActiveMocks(ws): ActiveMock[]` — enabled mocks on live requests; URL resolved with `envVars(ws)`; `key = matchKey(method, resolvedUrl)`; requests whose URL still has missing vars are skipped.
- `findDuplicate(ws, requestId): Item|null` — another live request with an enabled mock and the same key (resolved with the active env).
- `installMockRuntime(win, { readyTimeoutMs = 300 } = {}) → { setMocks(list), uninstall() }` in `mock-runtime.js`, written **without imports** so `mock-main.js` can be the same source: `mock-main.js` is generated by copying `mock-runtime.js` and appending `installMockRuntime(window); window.addEventListener('message', …)` — do this with a tiny `scripts/sync-mock-main.mjs` (`npm run sync`) and a test `mock-main is in sync` that compares the function body. Behavior:
  - Patches `win.fetch` and `win.XMLHttpRequest`. Until `setMocks` is first called, calls wait (max `readyTimeoutMs`), then decide.
  - fetch: accept `(input, init)` where input is string/URL/Request; compute method + absolute URL (relative to `win.location.href`); on match → after `delayMs` resolve `new win.Response(body, {status, headers})`; respect `init.signal` abort (reject `AbortError`). Else → original fetch with original args.
  - XHR: a subclass/wrapper that records `open(method,url)`; on `send` with a match → simulate readyState 1→2→3→4 with events (`readystatechange`, `loadstart`, `progress`, `load`, `loadend`), `status`, `statusText`, `responseText`, `response` (by `responseType`: '', 'text', 'json', 'blob' not required → treat as text), `responseURL`, `getResponseHeader`, `getAllResponseHeaders`. Else → real XHR behavior unchanged.
  - Mocked responses add header `x-fetchwing-mock: 1`.
- `mock-bridge.js` (isolated): on load reads `activeMocks`, posts `{ source: 'fetchwing', type: 'mocks', mocks }` to the page; re-posts on `chrome.storage.onChanged`.
- `mock-main.js` listens for that message (checks `event.source === window && data.source === 'fetchwing'`) and calls `setMocks`.

- [ ] **Step 1: Tests** (node, with a fake `win` = `{ fetch, XMLHttpRequest: FakeXHR, Response, Headers, location: {href}, setTimeout }`):
  - `deriveActiveMocks resolves env vars and skips missing`, `findDuplicate finds same key ignoring query order`.
  - `fetch returns mock when matching`, `passes through non-matching requests` (original called with identical args, Request object case), `waits for mocks before deciding` (call before `setMocks`, then `setMocks` → mocked), `times out to pass through when no mocks arrive`, `applies delay`, `abort rejects`.
  - `mocked XHR behaves like real one` (status, responseText, JSON responseType, headers, event order, `onload`), `XHR passes through non-matching`.
  - `mock-main is in sync`.
- [ ] **Steps 2–5:** FAIL → implement → PASS → commit `feat: add page mock runtime`.

### Task 5: Background worker — send, mock registration, badge

**Files:** Create `src/lib/send.js`, `src/background.js`, `tests/send.test.js`

**Interfaces:**
- Consumes: Tasks 2–4.
- Produces:
  - `buildSend(resolved): { url, init: {method, headers, body}, cookie: string|null }` — drops `Cookie` header into `cookie`; builds body per mode (json/text raw; urlencoded from fields → `URLSearchParams`; formdata → `FormData`); sets `Content-Type` for json/urlencoded if absent.
  - `executeSend({ resolved, fetchFn, dnr, now, ruleId }): Promise<Response-shape>` — when `cookie` present: add DNR session rule `{id: ruleId, priority: 1, action: {type:'modifyHeaders', requestHeaders:[{header:'cookie', operation:'set', value}]}, condition: {urlFilter: '|' + url + '|', resourceTypes:['xmlhttprequest','other']}}`, remove it in `finally`. Measures time, reads body text (truncate display at 2 MB → `bodyTruncated`), size from body length.
  - Worker: serialized `updateState` queue like Sticky Notes; handles messages listed above; after every workspace change → `activeMocks = deriveActiveMocks(ws)`, store it, badge text = count (`''` when 0, background `#d9480f`); `setMockEnabled` with `enabled:true` first checks `findDuplicate` → error string from Global Constraints; `addMockSite` stores origin and re-registers content scripts: `chrome.scripting.unregisterContentScripts()` then `registerContentScripts([{id:'fw-bridge', js:['src/content/mock-bridge.js'], matches, runAt:'document_start', allFrames:true}, {id:'fw-main', js:['src/content/mock-main.js'], matches, runAt:'document_start', world:'MAIN', allFrames:true}])` where `matches = origins.map(o => o + '/*')`; none → just unregister. Also inject into already-open tabs of that origin with `chrome.scripting.executeScript` (both scripts) so the user needn't reload.
- [ ] **Step 1: Tests** — `buildSend moves Cookie out of headers`, `urlencoded and json bodies get content type`, `cookie becomes a session rule and is removed` (fake dnr records add/remove even when fetch throws), `reports time, size and truncation`.
- [ ] **Step 2–4:** FAIL → implement → PASS (worker wiring not unit-tested).
- [ ] **Step 5:** Load in Playwright Chromium; worker starts with no errors.
- [ ] **Step 6:** Commit `feat: add background worker with send and mock registration`.

### Task 6: DevTools panel — collections, request editor, send, response, Paste cURL

**Files:** Create `src/devtools.html`, `src/devtools.js`, `src/panel/panel.html`, `panel.css`, `panel.js`, `tree.js`, `request-editor.js`, `response-view.js`

Behavior (two-column layout from the spec):
- `devtools.js`: `chrome.devtools.panels.create('Fetchwing', '', 'src/panel/panel.html')`.
- Panel gets the inspected tab via `chrome.devtools.inspectedWindow.tabId` when available, else `?tabId=` URL param (used by e2e tests).
- Top bar: environment select (`setActiveEnv`), "● N mocks ON" button (lists enabled mocks; click → select request), Settings button.
- Left: tree with expand/collapse, inline rename (double-click/F2), context menu (New folder, New request, Rename, Delete with inline confirm), drag to reorder/move; buttons **New** (request in selected collection/folder) and **Paste cURL** (reads clipboard via `navigator.clipboard.readText()`; on failure opens a textarea dialog; parse errors shown inline; warnings shown as a dismissible note) → `addItem` + select it.
- Right: method select, URL input, **Send** (Ctrl/Cmd+Enter); tabs Params (edits URL query live, two-way), Headers (key/value/enabled rows), Body (mode radio + editor). Unresolved `{{vars}}` highlighted red in URL and listed under the URL. Edits debounce 300 ms → `updateRequest`.
- Send flow: resolve URL origin; if `chrome.permissions.contains({origins:[origin+'/*']})` is false → `chrome.permissions.request` (in the click handler) → denied shows "Fetchwing needs permission to reach <origin>." → then `send` message.
- Response view: status pill (color by class), time, size; tabs Body (pretty JSON with collapsible tree if JSON else `<pre>`; "Raw" toggle) and Headers; **Mock this** button.
- Empty states copy: "Paste a cURL command or create a request to get started."

- [ ] **Step 1:** Implement.
- [ ] **Step 2: E2E (scratchpad harness):** load extension, open `src/panel/panel.html?tabId=<id>` in a tab; local HTTP test server on `127.0.0.1` (node `http`) with `/api/users?page=2` returning JSON and echoing cookies/headers. Check: Paste cURL (stub `navigator.clipboard.readText` via `page.evaluate` before click) creates request with parsed fields; Send → response shows 200 (permission prompts can't be clicked headless, so the harness loads a temp copy of the extension whose manifest adds `"host_permissions": ["http://127.0.0.1/*"]`; `permissions.contains` is then true and the request path is exercised; the prompt path is checked manually by the user), JSON body, server saw the cookie; rename, move, delete in tree persist after reload; no page errors.
- [ ] **Step 3:** `npm test` passes. Commit `feat: add DevTools panel with collections and request sending`.

### Task 7: Panel — mocks, environments, settings

**Files:** Create `src/panel/mock-editor.js`, `env-editor.js`, `settings-view.js`; modify `panel.js`, `panel.css`

Behavior:
- Mock tab: switch On/Off, status input (100–599), headers rows, body editor (JSON format button), delay ms. **Mock this** copies status/headers (minus hop-by-hop and `content-length`/`content-encoding`)/body into the mock and switches to the Mock tab (not enabled automatically).
- Turning a mock On: if the inspected page origin is not in `mockSites` → ask permission for that origin (`chrome.permissions.request`) then `addMockSite`; then `setMockEnabled`. Errors (duplicate) shown inline under the switch.
- A notice in the Mock tab when on: "Pages on <sites> get this response instead of the real API." with a link to Settings.
- Environments dialog: list envs, add/rename/delete, edit vars table (key, value, secret checkbox → value shown as dots with reveal).
- Settings view: granted API origins (from `chrome.permissions.getAll`) with Remove; mock sites with Remove (`removeMockSite`, also `chrome.permissions.remove` for that origin unless still needed for sending — keep it simple: only remove from mock sites).

- [ ] **Step 1:** Implement.
- [ ] **Step 2: E2E:** test web page served from `http://127.0.0.1:<port>/app.html` that calls `fetch('/api/users?size=10&page=2')` and an XHR to the same, rendering results into the DOM; panel opened with that tab's id; create request via Paste cURL `curl 'http://127.0.0.1:<port>/api/users?page=2&size=10'`, Send, **Mock this**, edit body to `{"users":["mocked"]}`, turn On (grant site), reload app tab → DOM shows mocked for both fetch and XHR; badge text `1`; close panel tab → reload app → still mocked; turn Off → real data; env var `{{base}}` URL mock matches when active env defines it; duplicate mock error shown; no page errors in panel or app.
- [ ] **Step 3:** `npm test` passes. Commit `feat: add mock editor, environments and settings`.
