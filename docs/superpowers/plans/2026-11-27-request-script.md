# Request Script Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Script tab on requests whose JavaScript runs after Send, reads the response, reads/writes the active environment, and logs to a Console pane.

**Architecture:** Pure script runtime in `src/lib/script-runtime.js` (no imports, tested in node), copied into a classic script for an MV3 sandboxed page (same generate-and-check pattern as `mock-main.js`). The panel talks to a hidden sandbox iframe via `postMessage`, then applies env changes through a new `applyEnvChanges` mutation.

**Tech Stack:** Vanilla ES modules, Chrome MV3, `node --test`. No dependencies.

**Spec:** `docs/superpowers/specs/2026-11-27-request-script-design.md`

## Global Constraints
- MV3 extension pages can't `eval`; user code runs only in `src/sandbox/script.html` (declared under `manifest.json` → `"sandbox": { "pages": [...] }`).
- API object is `fw`; `pm` is the same object. `fw.env` === `fw.environment`. UI and README mention only `fw` (README may say "scripts using `pm.*` also work"). Never the word "Postman" in UI/README.
- Timeout 5000 ms → Console error `Script timed out after 5 s`.
- New env keys from scripts are not secret; existing `secret` flags are kept. Secret values show as `••••` in Console.
- Script runs only after a successful Send from the request editor (not in Flows, not on error/cancel).
- No new dependencies. Work on branch `feat/request-script`.

## Review Focus
1. Requests saved before this change have no `script` field → editor shows empty, Send runs nothing (Task 1, Task 4 tests).
2. `fw.response.json()` on a non-JSON body throws → Console shows the error; `set` calls made before the throw are still applied (Task 2 test).
3. Logging circular objects, `undefined`, Errors, or `throw 'text'` never breaks the run (Task 2 tests).
4. Infinite loop → timeout, frame recreated, the next run works (Task 3 test).
5. No active environment → changes skipped, Console warns `No active environment — env changes were not saved` (Task 5 test).

---

### Task 1: Data model — `script` field and `applyEnvChanges`

**Files:**
- Modify: `src/lib/model.js` (`newRequest`, `REQUEST_FIELDS` line 85, `applyMutation`)
- Test: `tests/model.test.js`

**Interfaces:**
- Produces: request field `script: string`; mutation `{ type: 'applyEnvChanges', id: envId, changes: [{ op: 'set', key, value } | { op: 'unset', key }] }` → `{ workspace }` or `{ error: 'not_found' }`.

- [ ] **Step 1: Write failing tests** — update `newRequest defaults` to expect `script: ''`; add:
  - `updateRequest saves script`: patch `{ script: 'console.log(1)' }` → item.script equals it.
  - `applyEnvChanges sets, updates and unsets by key`: env vars `[{key:'a',value:'1',secret:true},{key:'b',value:'2',secret:false}]`, changes `[{op:'set',key:'a',value:'9'},{op:'set',key:'c',value:'3'},{op:'unset',key:'b'}]` → vars `[{key:'a',value:'9',secret:true},{key:'c',value:'3',secret:false}]`, `updatedAt` = now.
  - `applyEnvChanges on missing env` → `{ error: 'not_found' }`.
  - `applyEnvChanges ignores empty keys` → `{op:'set',key:'',value:'x'}` adds nothing.
- [ ] **Step 2:** `npm test` → new tests FAIL.
- [ ] **Step 3:** Implement: `script: ''` in `newRequest`; add `'script'` to `REQUEST_FIELDS`; `applyEnvChanges` case next to `updateEnvironment` (set replaces value in place or appends; unset removes; values `String()`ed).
- [ ] **Step 4:** `npm test` → all PASS.
- [ ] **Step 5:** Commit `feat: store request scripts and apply env changes by key`.

### Task 2: Script runtime (pure)

**Files:**
- Create: `src/lib/script-runtime.js` (no imports — it is copied verbatim into the sandbox)
- Test: `tests/script-runtime.test.js`

**Interfaces:**
- Produces:
  - `formatArg(value: any): string` — strings as-is; `undefined` → `'undefined'`; Error → `` `${name}: ${message}` ``; objects → `JSON.stringify(v, null, 2)` with a circular-safe replacer (`'[Circular]'`); falls back to `String(v)`.
  - `async runScript(source: string, { response, vars, compile }): Promise<{ logs: {level:'log'|'info'|'warn'|'error', text}[], changes: Change[], error?: string }>`
    - `response`: `{ status, statusText, timeMs, headers: [k,v][], bodyText }` (shape from `executeSend`).
    - `vars`: `{ [key]: string }`.
    - `compile(source) → (fw, pm, console) => Promise` — default `src => new Function('fw', 'pm', 'console', `return (async () => {\n${src}\n})();`)`.
    - `changes` collapsed per key, last op wins, in first-touched order.
    - `error`: thrown value formatted with `formatArg`; logs/changes collected before the throw are returned.
  - API: `fw.response.{code, status, responseTime, text(), json(), headers.get(name), headers.toObject()}`, `fw.environment.{get, set, unset, has, toObject}` (reads see earlier sets in the same run; `set` stringifies non-strings with `JSON.stringify`, strings unchanged), `fw.env`, `pm === fw`.

- [ ] **Step 1: Write failing tests** (with default `compile`):
  - `reads json and sets env`: body `{"token":"abc"}`, script `fw.env.set('token', fw.response.json().token)` → changes `[{op:'set',key:'token',value:'abc'}]`.
  - `pm alias works`: `pm.environment.set('id', pm.response.code)` with status 201 → value `'201'`.
  - `get sees earlier set; unset then has is false`.
  - `headers.get is case-insensitive`: headers `[['Content-Type','application/json']]`, `get('content-type')` → `'application/json'`.
  - `console levels and formatting`: `console.log('a', {b:1}); console.warn(undefined); console.error(new TypeError('x'))` → logs `[{level:'log',text:'a {\n  "b": 1\n}'},{level:'warn',text:'undefined'},{level:'error',text:'TypeError: x'}]`.
  - `circular object logs safely`.
  - `json on non-JSON body errors but keeps earlier changes`: script `fw.env.set('a','1'); fw.response.json();` → `changes` has `a`, `error` matches `/SyntaxError/`.
  - `throw 'text'` → `error === 'text'`.
  - `top-level await`: `await Promise.resolve(); console.log('ok')` → log `ok`.
  - `last op per key wins`: set a, unset a → `[{op:'unset',key:'a'}]`.
- [ ] **Step 2:** `node --test tests/script-runtime.test.js` → FAIL (module missing).
- [ ] **Step 3:** Implement `src/lib/script-runtime.js` per Interfaces; header comment says it has no imports because it is copied into the sandbox.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: add script runtime with fw/pm API`.

### Task 3: Sandbox page and panel runner

**Files:**
- Modify: `scripts/sync-mock-main.mjs` (add `buildScriptSandbox(runtimeSource)`; CLI writes both files)
- Create (generated): `src/sandbox/script-sandbox.js`; Create: `src/sandbox/script.html`
- Modify: `manifest.json` (add `"sandbox": { "pages": ["src/sandbox/script.html"] }`)
- Create: `src/panel/script-runner.js`
- Test: `tests/script-runner.test.js`; add `script-sandbox is in sync` to it (same as `mock-main is in sync`).

**Interfaces:**
- Consumes: `runScript` from Task 2.
- Message protocol:
  - panel → sandbox: `{ source: 'fetchwing-panel', type: 'run', runId, script, response, vars }`
  - sandbox → panel: `{ source: 'fetchwing-sandbox', type: 'ready' }` on load; `{ source: 'fetchwing-sandbox', type: 'result', runId, logs, changes, error? }` (posted to `event.source`, target `'*'`; sandbox origin is `null`).
- Produces: `createScriptRunner({ createFrame, timeoutMs = 5000, setTimer = setTimeout, clearTimer = clearTimeout })` → `{ run({ script, response, vars }): Promise<{ logs, changes, error? }> }`.
  - `createFrame(onMessage)` → `{ post(msg), destroy() }`; the runner calls it lazily, waits for `ready` before posting, ignores results with a stale `runId`.
  - On timeout: `destroy()`, resolve `{ logs: [], changes: [], error: 'Script timed out after 5 s' }`; next `run` creates a fresh frame.
  - Also export `iframeFrame(doc = document)` — the real `createFrame`: hidden `<iframe src="../sandbox/script.html">` appended to `doc.body`, `message` listener filtered by `event.source === iframe.contentWindow` and `data.source === 'fetchwing-sandbox'`; `post` uses `contentWindow.postMessage(msg, '*')`.

- [ ] **Step 1: Write failing tests** with a fake `createFrame` that runs `runScript` in-process (or never replies):
  - `waits for ready then resolves result`.
  - `times out, destroys frame, next run uses a new frame`: first fake never answers → error text exact; `createFrame` called twice after second run.
  - `ignores stale runId`.
  - `script-sandbox is in sync` → `readFileSync('src/sandbox/script-sandbox.js') === buildScriptSandbox(runtime)`, message `run \`npm run sync\``.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement `buildScriptSandbox` (strip `export `, wrap in IIFE, add message listener + ready post, banner `// GENERATED by scripts/sync-mock-main.mjs from src/lib/script-runtime.js — do not edit.`), `script.html` (`<script src="script-sandbox.js"></script>`, classic), manifest entry, `script-runner.js`. Run `npm run sync`.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat: run request scripts in a sandboxed page`.

### Task 4: Script tab in the request editor

**Files:**
- Modify: `src/panel/request-editor.js`, `src/panel/panel.css`

**Interfaces:**
- Draft gains `script: request.script ?? ''`; saved via existing `opts.onChange` (→ `updateRequest`).
- Tab list becomes Params / Headers / Body / Script; Script tab shows a dot (`span.count` with `•`) when `draft.script.trim()` is non-empty.

- [ ] **Step 1:** Add tab: `textarea.code-area` (`aria-label: 'Script'`, placeholder `// Runs after the response arrives\nconst data = fw.response.json();\nfw.env.set('token', data.token);`) and hint line `Runs after each Send. Use fw.response.json(), fw.env.get/set(), console.log(). Scripts using pm.* also work.`
- [ ] **Step 2:** Tab key inside the script textarea inserts two spaces (no focus jump).
- [ ] **Step 3:** `npm test` still PASS; manual check deferred to Task 6.
- [ ] **Step 4:** Commit `feat: add Script tab to the request editor`.

### Task 5: Run after Send + Console pane

**Files:**
- Create: `src/lib/script-console.js`, `src/panel/console-view.js`
- Modify: `src/panel/panel.js` (`sendActive` ~line 472, `renderBottom` ~526), `src/panel/panel.html` (resp-head tabs + `#consolePane`), `src/panel/panel.css`, `README.md` (Features bullet)
- Test: `tests/script-console.test.js`

**Interfaces:**
- Consumes: `createScriptRunner`, `iframeFrame` (Task 3); `applyEnvChanges` (Task 1).
- Produces: `consoleEntries(result, { secretKeys: Set<string>, envSaved: boolean }): { level, text }[]` — logs first; then `error` as `{level:'error'}`; then one `{level:'info', text: 'env set token = abc'}` / `'env unset token'` per change (value `••••` when key in `secretKeys`); if `!envSaved && changes.length`, a `warn` `No active environment — env changes were not saved` instead of the change lines.
- `renderConsole(pane, entries, { onClear })` — rows with level class, empty state `Console output from the request script shows here`.

- [ ] **Step 1: Write failing tests** for `consoleEntries`: ordering, secret masking, no-env warning, empty result → `[]`.
- [ ] **Step 2:** Run → FAIL; implement `script-console.js`; run → PASS.
- [ ] **Step 3:** Panel wiring: one module-level runner (`createScriptRunner({ createFrame: iframeFrame })`). In `sendActive`, after `res.ok` and `draft.script?.trim()`: run with `envVars(state.ws)`; if `state.ws.activeEnvId` env is live and changes exist, `mutate({ type: 'applyEnvChanges', id, changes })`; store entries in `state.consoles` (Map by request id, keyed by the sent item, not the active one). Add `Console` subtab (`data-pane="console"`, red dot `#consoleDot` when any error entry) and `#consolePane`; `renderBottom` handles the third pane; Clear empties the entries for that request.
- [ ] **Step 4:** README Features: add `- **Scripts.** Run JavaScript after a response arrives: read it with fw.response, save values into the environment with fw.env.set, and see console.log output in the Console. Scripts using pm.* also work.`
- [ ] **Step 5:** `npm test` → PASS. Commit `feat: run scripts after Send and show a Console`.

### Task 6: Verify in Chrome

- [ ] Load unpacked, open DevTools → Fetchwing. Send `https://httpbin.org/json` (or any JSON API) with script `console.log(fw.response.json()); fw.env.set('slide', fw.response.json().slideshow.title)` → Console shows object and `env set slide = …`; env tab shows the var; `{{slide}}` resolves in the next request.
- [ ] `while(true){}` → Console shows `Script timed out after 5 s`; next Send runs fine.
- [ ] Non-JSON response + `fw.response.json()` → error in Console, Response pane unchanged.
- [ ] Dark/light themes and narrow layout look right.
