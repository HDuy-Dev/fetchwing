# Flow Logic Block Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `logic` block kind to Flows. It runs a JS script in the existing sandbox, reads upstream variables through `fw.vars`, and returns declared outputs that downstream blocks use as `{{name}}`.

**Architecture:** Pure helpers live in a new `src/lib/logic-block.js`: variable scan, return-value check, fingerprint, and output detection. `flow-graph.js` and `flow-run.js` learn the new kind. The run engine receives `runLogic` as an injected function, so it stays testable. `script-runtime.js` gains `runLogic`, the sandbox accepts a `logic` message, and `script-runner.js` gains `cancel()`. The panel files (`flow-canvas.js`, `flow-details.js`, `flow-view.js`, `flow-runner.js`) branch on `block.kind === 'logic'`.

**Tech Stack:** Vanilla ES modules, MV3 extension, `node --test`, no dependencies.

**Spec:** `docs/superpowers/specs/2026-11-27-flow-logic-block-design.md`. It extends `2026-11-26-flows-design.md` and `2026-11-27-request-script-design.md`.

## Global Constraints

- ES modules, no build step, no new dependencies; pure logic in `src/lib/`, UI in `src/panel/`; tests with `node --test`.
- UI copy in English; reuse `panel.css` tokens and the `code-area` style.
- User code only runs in `src/sandbox/script.html` through `createScriptRunner` (fresh iframe per run, 5 s timeout). After editing `src/lib/script-runtime.js`, run `npm run sync`.
- Flows never write the environment. `fw.environment.set/unset` throw `Flows can't change the environment. Return a value instead.`
- Block shape: `{ id, kind: 'logic', name: 'Logic', script: '', x, y, outputs: [{ name }] }`. A block without `kind`, or with `kind: 'request'`, is a request block.
- Exact error copy:
  - `Script must return an object like { name: value }`
  - `Output \`x\` is too large (max 1 MB)`
  - `Output \`x\` can't be saved as JSON`
  - `Script timed out after 5 s` (the existing `TIMEOUT_ERROR`)
  - unknown key warning: `Returned \`x\` is not a declared output, so it was ignored`
  - conflicting name warning: `\`x\` comes from more than one block, so fw.vars leaves it out`

## Review Focus

1. **A script that never resolves while the user presses Stop.** The block should end as failed (cancelled) and its iframe should be removed, while the rest of the run stops normally. This is pinned in Task 3 (`cancel`) and Task 4 (abort test).
2. **A script that returns `null`, an array, a string, or a promise of these.** The block should fail with the "must return an object" error, unless no outputs are declared and the value is `undefined`. Pinned in Task 1.
3. **An env var that is a numeric string (`"3"`), next to an upstream output that is a number.** `fw.vars.get` should return each one as it was given, without coercion. Pinned in Task 4.
4. **An old workspace or synced flow with blocks lacking `kind`.** These should still behave exactly as request blocks. Pinned in Task 2.
5. **Run from here with an edited upstream logic script.** It should stay enabled, show the "Using outputs from an earlier run" warning, and mark the upstream block outdated. Pinned in Task 5.

---

### Task 1: Pure logic-block helpers

**Files:**
- Create: `src/lib/logic-block.js`
- Test: `tests/logic-block.test.js`

**Interfaces:**
- Produces:
  - `scanVars(script: string) -> { required: string[], optional: string[] }` (sorted, de-duplicated).
    - Matches `(fw|pm).vars.get('x')` and `.has('x')` with single quotes, double quotes, or backticks without `${`, allowing whitespace.
    - A name in both `get` and `has` is required.
    - Comments are not stripped (accepted limitation).
  - `checkLogicValue(value: unknown, outputNames: string[]) -> { outputs: object, warnings: string[], error?: string }`
  - `logicFingerprint(block, envVars: object) -> string`: JSON of `{ script, outputs: names, env }`, where `env` holds the scanned names (required ∪ optional) mapped to their env value or `null`.
  - `detectOutputs(script: string) -> string[]`: keys of the **last** `return {` … `}` object literal found. It returns shorthand and `key:` names at depth 1, and `[]` when no literal is found.
  - `newLogicBlock({ id, x, y }) -> block` with `name: 'Logic'`, `script: ''`, `outputs: []`.
  - `MAX_OUTPUT_BYTES = 1_000_000`.

- [ ] **Step 1: Write the failing tests**

```js
test('scanVars finds literal get/has names; has-only names are optional', () => {
  const s = "const a = fw.vars.get('price'); if (pm.vars.has(\"qty\")) x = fw.vars.get(`qty`); fw.vars.has('coupon'); fw.vars.get(key);";
  assert.deepEqual(scanVars(s), { required: ['price', 'qty'], optional: ['coupon'] });
  assert.deepEqual(scanVars('fw.vars.get(`a${b}`)'), { required: [], optional: [] });
});
test('checkLogicValue keeps declared keys, warns on others', () => {
  const r = checkLogicValue({ total: 6, extra: 1 }, ['total', 'ids']);
  assert.deepEqual(r.outputs, { total: 6 });
  assert.deepEqual(r.warnings, ['Returned `extra` is not a declared output, so it was ignored']);
  assert.equal(r.error, undefined);
});
test('checkLogicValue rejects non-objects only when outputs are declared', () => {
  for (const v of [null, [1], 'x', 3]) assert.equal(checkLogicValue(v, ['a']).error, 'Script must return an object like { name: value }');
  assert.deepEqual(checkLogicValue(undefined, []), { outputs: {}, warnings: [] });
  assert.equal(checkLogicValue(undefined, ['a']).error, 'Script must return an object like { name: value }');
});
test('checkLogicValue rejects unserialisable and >1 MB outputs', () => {
  const loop = {}; loop.self = loop;
  assert.equal(checkLogicValue({ a: loop }, ['a']).error, 'Output `a` can\'t be saved as JSON');
  assert.equal(checkLogicValue({ a: () => 1 }, ['a']).error, 'Output `a` can\'t be saved as JSON');
  assert.equal(checkLogicValue({ a: 'x'.repeat(1_000_001) }, ['a']).error, 'Output `a` is too large (max 1 MB)');
});
test('logicFingerprint changes with script, output names and scanned env values only', () => {
  const b = { script: "fw.vars.get('k')", outputs: [{ name: 'o' }] };
  const fp = logicFingerprint(b, { k: '1', other: 'x' });
  assert.equal(fp, logicFingerprint(b, { k: '1', other: 'y' }));
  assert.notEqual(fp, logicFingerprint(b, { k: '2' }));
  assert.notEqual(fp, logicFingerprint({ ...b, script: b.script + ';' }, { k: '1' }));
  assert.notEqual(fp, logicFingerprint({ ...b, outputs: [] }, { k: '1' }));
});
test('detectOutputs reads the last returned object literal', () => {
  assert.deepEqual(detectOutputs('if (x) return { a: 1 };\nreturn { total, ids: [1, { z: 2 }], "q": 3 };'), ['total', 'ids', 'q']);
  assert.deepEqual(detectOutputs('return result;'), []);
});
```

- [ ] **Step 2: Run `node --test tests/logic-block.test.js`.** Expected: FAIL (module not found).
- [ ] **Step 3: Implement `src/lib/logic-block.js`.**
  - `checkLogicValue`: when `outputNames` is empty and `value === undefined`, return no error. Otherwise require a plain object (not an array). For each declared key that is present, check `JSON.stringify(v)`: if it throws or returns `undefined`, the value can't be saved as JSON; if its UTF-8 byte length is over `MAX_OUTPUT_BYTES`, it is too large. Report the first error in declared order.
  - `detectOutputs`: a small scanner that tracks brace depth and skips strings, not a parser.
- [ ] **Step 4: Run `node --test tests/logic-block.test.js`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: add logic block helpers`.

---

### Task 2: Graph analysis for logic blocks

**Files:**
- Modify: `src/lib/flow-graph.js` (`analyzeFlow`, `edgeVars`; add `fingerprintOf`, `isLogic`, `visibleProviders`)
- Test: `tests/flow-graph.test.js`

**Interfaces:**
- Consumes: `scanVars`, `logicFingerprint` (Task 1).
- Produces:
  - `isLogic(block) -> boolean` (`block.kind === 'logic'`).
  - `analyzeFlow` entry for a logic block: `{ logic: true, request: null, deleted: false, uses, missing, conflicts }`.
    - `uses` covers required ∪ optional names.
    - `missing` and `conflicts` are computed **only for required names**.
    - An optional name with no provider is left out of `uses`.
  - Request entries are unchanged, with `logic: false`.
  - `edgeVars(ws, flow, edge)`: when the target is a logic block, used names = required ∪ optional. When the source is a logic block, its outputs are `{ name }` (no path); the code is unchanged because it only reads `.name`.
  - `fingerprintOf(ws, block, envVars) -> string | null`: `logicFingerprint` for logic blocks; `blockFingerprint(request, envVars)` for a live request; `null` for a deleted request.
  - `visibleProviders(flow, blockId) -> Map<name, blockId | null>`: for every output name declared upstream, the nearest provider. The value is `null` when two nearest providers conflict. Refactor the nearest-provider rule out of `analyzeFlow` so both use it.

- [ ] **Step 1: Write the failing tests** in `tests/flow-graph.test.js`:
  - `analyzeFlow marks a logic block missing only for required names`: script `fw.vars.get('a'); fw.vars.has('b')`, no providers, env `{}` → `missing: ['a']`, `uses` has only `a`, `deleted: false`, `logic: true`.
  - `analyzeFlow resolves logic inputs from upstream outputs and env`: upstream request outputs `a`, env has `b`, the script gets both → `uses: [{name:'a',from:<upId>},{name:'b',from:'env'}]`.
  - `logic outputs feed downstream request vars`: logic block with outputs `[{name:'total'}]` → downstream request `{{total}}` → `uses` from the logic id. `edgeVars` gives `['total']`.
  - `edgeVars into a logic block lists scanned names`.
  - `blocks without kind still analyse as requests`: a block `{ id, requestId, outputs }` with no `kind` gives the same entry as before.
  - `fingerprintOf` returns `null` for a deleted request, and a different string after a script edit.
  - `visibleProviders`: chain A→B→L, where both A and B declare `x` → `x` maps to B. In parallel branches A→L and B→L, both declaring `y` → `y` maps to `null`.
- [ ] **Step 2: Run `node --test tests/flow-graph.test.js`.** Expected: the new tests FAIL.
- [ ] **Step 3: Implement the changes** listed under Interfaces.
- [ ] **Step 4: Run `npm test`.** Expected: all PASS (existing flow tests unchanged).
- [ ] **Step 5: Commit** `feat: analyse logic blocks in flow graphs`.

---

### Task 3: Sandbox `runLogic` and runner cancel

**Files:**
- Modify: `src/lib/script-runtime.js` (add `runLogic`)
- Modify: `scripts/sync-mock-main.mjs` (`buildScriptSandbox` handles `type: 'logic'`)
- Regenerate: `src/sandbox/script-sandbox.js` (`npm run sync`)
- Modify: `src/panel/script-runner.js` (generic job message, `cancel()`)
- Test: `tests/script-runtime.test.js`, `tests/script-runner.test.js`

**Interfaces:**
- Produces:
  - `runLogic(source, { vars = {}, env = {}, compile }) -> Promise<{ logs, value, error? }>`. Inside the script:
    - `fw.vars.get/has/toObject` read `vars`, keeping each value's type.
    - `fw.environment` and `fw.env` give read-only `get/has/toObject` over `env`.
    - `fw.environment.set`/`unset` throw `Flows can't change the environment. Return a value instead.`
    - `fw.response` is a getter that throws `fw.response is not available in a Logic block`.
    - `pm === fw`; `console` is the same as in `runScript`.
    - `value` is the script's return value; it is `undefined` when the script throws.
    - The same `compile` is reused, so the script body is wrapped in an async function and `return` works.
  - Sandbox message `{ source: 'fetchwing-panel', type: 'logic', runId, script, vars, env }` is answered with `{ source: 'fetchwing-sandbox', type: 'result', runId, logs, value, error? }`.
    - A `value` that `postMessage` can't clone (a function, for example) is answered with `error: "Output can't be sent back from the script"`. Wrap the post in try/catch.
  - `createScriptRunner(...).run(job)`:
    - `job` is either `{ script, response, vars }` (existing, posts `type: 'run'`) or `{ mode: 'logic', script, vars, env }` (posts `type: 'logic'`).
    - It resolves with the sandbox result, passed through as is (`value` included).
    - A timeout resolves `{ logs: [], error: TIMEOUT_ERROR, timedOut: true }` for logic jobs (and keeps `changes: []` for run jobs).
  - `cancel()`:
    - A running job's frame is destroyed and the job resolves `{ logs: [], cancelled: true, error: 'Stopped' }`.
    - Queued jobs resolve the same way without being posted.
    - Jobs added after `cancel()` run normally.

- [ ] **Step 1: Write the failing tests.**
  - script-runtime:
    - `runLogic returns the value and keeps var types`: vars `{ n: 2, s: '3', arr: [1] }`; script `return { t: fw.vars.get('n') * Number(fw.vars.get('s')), same: Array.isArray(pm.vars.get('arr')) }` → `value` deep-equals `{ t: 6, same: true }`.
    - `runLogic env is read-only`: `fw.env.set('a', 1)` → `error` includes `Flows can't change the environment`.
    - `runLogic fw.response throws a clear error`.
    - `runLogic await works`: `return { v: await Promise.resolve(1) }`.
  - script-runner, using the existing `fakeFrames`:
    - `logic job posts type logic with vars and env`.
    - `cancel resolves running and queued jobs as cancelled and destroys the frame`.
    - `a job after cancel runs`.
  - sync: `buildScriptSandbox output answers a logic message`, following the existing generator test.
- [ ] **Step 2: Run `node --test tests/script-runtime.test.js tests/script-runner.test.js`.** Expected: the new tests FAIL.
- [ ] **Step 3: Implement** `runLogic`, the generator branch and the runner changes, then run `npm run sync`.
- [ ] **Step 4: Run `npm test`.** Expected: all PASS, and `git diff src/sandbox/script-sandbox.js` shows the new `logic` branch.
- [ ] **Step 5: Commit** `feat: run logic scripts in the sandbox`.

---

### Task 4: Run engine executes logic blocks

**Files:**
- Modify: `src/lib/flow-run.js`
- Test: `tests/flow-run.test.js`

**Interfaces:**
- Consumes:
  - `isLogic`, `visibleProviders`, `fingerprintOf`, `analyzeFlow` (Task 2).
  - `checkLogicValue` (Task 1).
- Produces:
  - `runFlow` option `runLogic({ blockId, script, vars, env, signal }) -> Promise<{ logs, value, error?, timedOut?, cancelled? }>`. It is required only when the flow has logic blocks. If it is missing, the logic block fails with `error: 'Logic blocks can't run here'`.
  - Logic block results:
    - running: `{ state: 'running', startMs, fingerprint, logic: true }`
    - ok: `{ state: 'ok', outputs, logs, value, warnings, startMs, endMs, fingerprint, logic: true }`
    - failed: `{ state: 'failed', errorKind: 'script' | 'timeout' | 'cancelled', error, logs, ... }`
  - Every block result now uses `fingerprintOf` for `fingerprint`.

Building `vars` for a logic block:
- For each `[name, provider]` of `visibleProviders(flow, id)`:
  - `provider === null`: leave the name out and add the conflicting-name warning.
  - the provider's outputs have the name: `vars[name] = outputs[name]`, keeping the value as is.
- Then add each env var that is not already set: `vars[name] ??= envVars[name]`. Flow outputs win over env.
- `env` is `envVars`.

The existing `missing`/`conflicts` pre-check applies to logic blocks unchanged. The runtime check that a required name is unset reuses the existing `unset` logic over `uses`.

- [ ] **Step 1: Write the failing tests** (use a fake `runLogic` that calls `runLogic` from `script-runtime.js` with `compile` left as the default, since Node allows `new Function`):
  - `A and B feed a logic block whose output feeds C`:
    - A outputs `price = 2` (a number); B outputs `qty`, a string `"3"` taken from the body.
    - Logic: `return { total: fw.vars.get('price') * Number(fw.vars.get('qty')) }`, outputs `[{name:'total'}]`.
    - C's URL uses `{{total}}`.
    - Assert that C's `send` saw `vars.total === 6`, the logic result is `{ state: 'ok', outputs: { total: 6 } }`, and `typeof` of the price the script saw is `'number'`. Capture it with `console.log(typeof fw.vars.get('price'))` and check `logs[0].text === 'number'`.
  - `a logic block with no parents runs first with hard-coded values`.
  - `a throwing script fails the block with errorKind script and skips downstream`.
  - `a timeout gives errorKind timeout`: fake `runLogic` returns `{ logs: [], error: 'Script timed out after 5 s', timedOut: true }`.
  - `returning a non-object with declared outputs fails`.
  - `undeclared keys are warned, not output`.
  - `conflicting upstream names are left out of fw.vars with a warning`.
  - `abort while a logic block runs marks it failed cancelled`: the fake `runLogic` waits on `signal`.
  - `missing runLogic fails logic blocks with a clear error`.
- [ ] **Step 2: Run `node --test tests/flow-run.test.js`.** Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
  - In `start`, branch on `isLogic(block)`: `exec` calls `runLogic`, and a new `settleLogic(block, res)` maps the result.
    - `res.cancelled` gives `cancelled`; `res.timedOut` gives `timeout`; `res.error` gives `script`.
    - Otherwise call `checkLogicValue(res.value, names)`. If it returns an error, that is a `script` failure. If not, the block is ok with warnings = conflict warnings + check warnings.
  - Logic blocks don't count against the request `concurrency` limit. The runner serialises them.
- [ ] **Step 4: Run `npm test`.** Expected: all PASS.
- [ ] **Step 5: Commit** `feat: run logic blocks in flows`.

---

### Task 5: Run records, runner wiring, sync compatibility

**Files:**
- Modify: `src/lib/flow-record.js` (`sameUpstream` also compares `kind`)
- Modify: `src/panel/flow-runner.js`:
  - fingerprints via `fingerprintOf`
  - `flowOrigins` skips logic blocks
  - new option `createLogicRunner`
  - `stop` cancels it
- Modify: `src/panel/flow-view.js` (pass `createLogicRunner: () => createScriptRunner({ createFrame: iframeFrame() })`)
- Test: `tests/flow-record.test.js`, `tests/flow-runner.test.js`, `tests/sync-merge.test.js`

**Interfaces:**
- Consumes:
  - `fingerprintOf` (Task 2)
  - `runFlow({ runLogic })` (Task 4)
  - `createScriptRunner().run/cancel` (Task 3)
- Produces: `createRunner({ ..., createLogicRunner?: () => { run(job), cancel() } })`.
  - Each `run()` creates one logic runner.
  - It passes `runLogic: ({ script, vars, env }) => logic.run({ mode: 'logic', script, vars, env })` to `runFlow`.
  - `stopActive()` and the failure path call `logic.cancel()`.

- [ ] **Step 1: Write the failing tests.**
  - flow-record:
    - `runFromHere stays enabled with a warning when an upstream logic script changed`: same `kind` and outputs, and the script changed so it is outdated. Pass `outdatedIds: [logicId]` → `{ enabled: true, warn: 'Using outputs from an earlier run' }`.
    - `runFromHere is off when upstream logic outputs were renamed`.
    - `runFromHere is off when an upstream block changed kind`.
  - flow-runner:
    - `logic blocks are not in flowOrigins`.
    - `stop cancels the logic runner`: use a fake `createLogicRunner` whose `run` never resolves until `cancel` is called.
    - `snapshot fingerprints include logic blocks`.
  - sync-merge: `logic blocks survive toRemote/merge unchanged`, including `script`, `name`, `kind`, and outputs without `path`. Also add `updateFlow keeps unknown block fields` in the existing workspace/model test file that covers `updateFlow` (find it with `grep -n updateFlow tests/*.js`).
- [ ] **Step 2: Run** `node --test tests/flow-record.test.js tests/flow-runner.test.js tests/sync-merge.test.js`. Expected: the new tests FAIL. If the sync tests already pass, which the reviewer expects, keep them as regression tests.
- [ ] **Step 3: Implement** the changes listed under Files.
- [ ] **Step 4: Run `npm test`.** Expected: all PASS.
- [ ] **Step 5: Commit** `feat: wire logic blocks into flow runs`.

---

### Task 6: Canvas: add, paint and menu for logic blocks

**Files:**
- Modify: `src/panel/flow-canvas.js`:
  - `addLogic()`
  - `paintNode` logic branch
  - `menuFor` logic items
  - `statusOf` (no "Request deleted" for logic)
  - the outdated check via `fingerprintOf`
- Modify: `src/panel/flow-view.js`:
  - `addBlock` opens `showMenu` with **Request…** (existing search) and **Logic** (`canvas.addLogic()`)
  - empty-state copy: `Add a request from a collection, or a Logic block, with ＋ Block.`
- Modify: `src/panel/flows.css` (`.m.JS` badge style, using an existing neutral token)

**Interfaces:**
- Consumes: `newLogicBlock`, `isLogic`, `fingerprintOf`.
- Produces: `canvas.addLogic()`. It adds the block at the view centre (same placement as `addRequest`), then calls `onSelect(id)` and `onLogicAdded?.(id)`. `flow-view` uses that callback to open the details on the Script tab (Task 7).

The logic node renders:
- the badge `JS` where the method usually goes (class `m JS`)
- the block `name`
- a middle line `→ total, ids`, or `No outputs` when the block declares none (`midEllipsis(…, 30)`)
- the usual status line and missing/conflict flags

The context menu is **Run from here**, **Duplicate** and **Delete**. Duplicate copies the block with a new id at +32/+32, and does not copy edges.

- [ ] **Step 1: Implement** the changes listed above. Drag and drop from the collection tree is unchanged.
- [ ] **Step 2: Run `npm test`.** Expected: all PASS.
- [ ] **Step 3: Check in the browser.**
  - Load the unpacked extension the same way previous flow tasks did (see `docs/superpowers/plans/2026-11-26-flows.md` for the verification setup).
  - Open a flow and use ＋ Block → Logic. A `JS` node should appear and be selected.
  - Right-click it: the menu shows Run from here, Duplicate and Delete, and Duplicate adds a copy.
  - Check both light and dark themes, and a panel 360px wide.
- [ ] **Step 4: Commit** `feat: add logic blocks to the flow canvas`.

---

### Task 7: Details column for logic blocks

**Files:**
- Modify: `src/panel/flow-details.js`:
  - logic tabs and header
  - extract `outputNameError(name, outputs, index)` from `outputError`, which then calls it
- Modify: `src/panel/flows.css`
- Test: `tests/flow-details.test.js`

**Interfaces:**
- Consumes:
  - `detectOutputs`, `scanVars` (Task 1)
  - logic results (Task 4)
  - `consoleEntries`-style rendering: reuse the Console row markup or classes from the request Console. Build entries as `logs` + `warnings` (level `warn`) + `error` (level `error`).
- Produces:
  - `export const LOGIC_TABS = [['script', 'Script'], ['io', 'Inputs / Outputs'], ['console', 'Console']]`
  - `export function outputNameError(name, outputs, index) -> string | null`, with the same messages as today.
  - `export function logicConsole(result) -> [{ level, text }]`
  - `details.openTab(tab)`, used after `addLogic`.

Behaviour for a logic block:

- **Header:**
  - the `JS` badge
  - the name, editable in place (an input that saves on blur or Enter; an empty name reverts to `Logic`)
  - the status line `✓ 3 ms`
  - the *outdated* label
- **Tabs:** the stored `flowTab` is kept per kind. A request-only tab falls back to `script`, and `script`/`console` fall back to `io` for requests.
- **Script tab:**
  - a `textarea.code-area` that saves `{ blocks }` with the new `script` after 400 ms of no typing, and on blur
  - a hint line: `fw.vars.get('x') · return { name: value } · console.log() · env values are text: use Number(...)`
  - an **Outputs** list of names, each with ✕ to remove
  - an input with **＋ Add output** (errors from `outputNameError`)
  - a **Detect** button that adds the names from `detectOutputs` that are not already listed, and toasts `No new outputs found` when there are none
- **Inputs / Outputs tab:** reuse `ioTab`. Outputs rows have no path column for logic blocks. The empty text is `No outputs yet. Add one in the Script tab.`
- **Console tab:** `logicConsole(run.blocks[id])` rows, or `Not run yet`. The tab label shows a red dot when an error is present.
- A failed or skipped block keeps the existing banner and why-note behaviour.
- **Displayed value:** when the block is ok, the Console tab ends with an `info` row `Returned: <JSON>`. That row and each log text are cut at 256 KB, with a `… (truncated)` suffix. Pin this in the `logicConsole` tests.
- **Block names everywhere:** the block-name helper (currently `analysis.get(id)?.request?.name ?? …`, around line 124) returns `b.name || 'Logic'` for logic blocks. The run overview, the timeline, Needs attention and the "skipped because of" links therefore show the logic block's name. The `why()` text for a deleted request never applies to logic blocks.

- [ ] **Step 1: Write the failing tests:**
  - `outputNameError` keeps today's messages.
  - `logicConsole` orders logs, then warnings, then the error.
  - `logicConsole` of an undefined result is `[]`.
  - `logicConsole` of an ok result ends with `Returned: {"total":6}`.
  - A log longer than 256 KB ends with `… (truncated)`.
- [ ] **Step 2: Run `node --test tests/flow-details.test.js`.** Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the behaviour listed above.
- [ ] **Step 4: Run `npm test`.** Expected: all PASS.
- [ ] **Step 5: Check in the browser** with an end-to-end flow.
  - Build: two requests (A, B) → Logic `return { total: fw.vars.get('price') * Number(fw.vars.get('qty')) }` → request C using `{{total}}`.
  - The edge labels show `price`/`qty` and `total`.
  - Run. Logic shows ✓, its Console shows logs, and C's Request tab shows the substituted total.
  - Edit the script. Logic shows *outdated*, and Run from here on C shows the earlier-run warning.
  - Make the script throw. Logic shows ✕ with the error, and C is skipped "because of Logic".
  - Run `while(true){}`. After about 5 s the block fails with `Script timed out after 5 s`.
  - Press Stop during a slow `await new Promise(r => setTimeout(r, 4000))`. The block shows cancelled.
- [ ] **Step 6: Commit** `feat: edit and inspect logic blocks in the details column`.
