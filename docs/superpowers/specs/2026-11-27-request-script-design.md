# Request script (post-response) — design

## Why
Users want to process a response with JavaScript right after Send, like a
post-response script in other API clients: read the body, pull out values
(a token, an id) and save them into the active environment so the next
request can use `{{token}}`. A Console shows what the script logged.

## Goals
- A **Script** tab next to Params / Headers / Body in the request editor.
- The script runs after every successful Send from the request editor.
- The script can read the response and read/write the active environment.
- A **Console** pane next to Response and Mock shows logs, errors and the
  env changes the script made.
- Scripts written with `pm.*` (copied from Postman) mostly run unchanged.

## Non-goals (this round)
- Pre-request scripts.
- Running scripts inside Flows.
- `pm.test`, `pm.sendRequest`, `pm.globals`, `pm.collectionVariables`, `require`.

## Anti-goals
- A script must never hang or crash the panel, or reach `chrome.*` or the workspace directly.
- No Postman name or branding in the UI or docs: we document `fw`; `pm` is an undocumented-in-UI alias
  (only mentioned as "scripts using `pm.*` also work").

## Constraints
- MV3 extension pages forbid `eval` / `new Function`. Code runs in a
  **sandboxed page** (`manifest.json` → `"sandbox": { "pages": ["src/sandbox/script.html"] }`),
  loaded in a hidden iframe in the panel, talking via `postMessage`.
- No new dependencies (repo uses none).

## Approaches considered
1. **Sandbox iframe in the panel + `fw` API with `pm` alias** — chosen. Works in MV3,
   isolates user code, pasted Postman scripts mostly work, our own naming in UI.
2. `chrome.userScripts` — needs the user to enable Developer mode. Rejected.
3. Declarative path extraction (like Flow outputs) — not JavaScript. Rejected.
4. `pm`-only API — user preferred own `fw` naming with `pm` support.

## Design
**Data.** Request gets `script: string` (default `''`), added to `newRequest` and
`REQUEST_FIELDS`; synced like other request fields.

**Script API** (inside the sandbox; `pm` === `fw`):
- `fw.response.code`, `.status` (status text), `.responseTime` (ms), `.text()`, `.json()` (throws on invalid JSON),
  `.headers.get(name)` (case-insensitive), `.headers.toObject()`.
- `fw.environment.get(key)`, `.set(key, value)` (value stringified; objects → JSON), `.unset(key)`, `.has(key)`,
  `.toObject()`. `fw.env` is a short alias of `fw.environment`.
- `console.log / info / warn / error` — args serialised (objects as JSON, errors with message).
- Top-level `await` allowed (script wrapped in an async function).
- Timeout 5 s: the iframe is torn down and recreated; Console shows "Script timed out".

**Flow.** After `sendActive` gets a response and the request has a non-empty script:
panel posts `{ runId, script, response, vars }` to the sandbox → sandbox returns
`{ runId, logs: [{level, text}], changes: [{op:'set'|'unset', key, value}], error? }`.
Panel applies changes with a new mutation **`applyEnvChanges`** `{ id, changes }`
(merges by key so it doesn't overwrite edits made elsewhere; existing `secret` flag kept;
new keys are not secret). If no active environment exists, changes are skipped and
Console says so. Env views/picker refresh after.

**UI.**
- Script tab: monospace textarea (same `code-area` style as Body), badge dot when non-empty,
  short hint line listing `fw.response.json()`, `fw.environment.set()`, `console.log()`.
- Console pane: one row per entry, level colour, time; env changes listed as
  `env set token` (secret values masked `••••`). "Clear" button. Console tab shows a count/red dot on error.
  Console entries are per request, kept in memory (like responses), not persisted.
- Script errors don't change the Response pane; they appear in Console with message (+ line if available).

## Left to the builder
- Exact module split (suggest `src/lib/script-api.js` pure + tested, `src/sandbox/script.{html,js}`,
  `src/panel/script-runner.js`, `src/panel/console-view.js`).
- Styling details, following existing panel.css tokens.
