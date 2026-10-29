# Fetchwing Drive Sync and Store Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync each user's Fetchwing workspace to one JSON file in their own Google Drive, and make the extension ready to submit to the Chrome Web Store.

**Architecture:** Pure merge functions decide what wins per item. A Drive client and a Google auth module (ported from Sticky Notes Sync) do the I/O. A syncer in the service worker runs merge rounds after edits, on a timer and on demand. The panel shows a cloud button with the sync state and a sign-in menu. Store readiness adds icons, a licence, a GitHub Pages site with a privacy policy, a compliance note, a publishing guide and a zip script.

**Tech Stack:** Chrome MV3 (`identity.launchWebAuthFlow`, `alarms`), Google Drive REST v3, plain ES modules, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-29-fetchwing-design.md` (§5, §6.4, §6.7, §6.8, §7)

**Reference implementation:** `/Users/hoangduy/Products/sticky-notes-sync` — `src/lib/google-auth.js`, `src/lib/sheets-store.js` (error handling), `src/lib/sync.js`, `tests/google-auth.test.js`, `docs/PUBLISHING.md`, `docs/COMPLIANCE.md`, `docs/privacy.html`, `docs/index.html`, `scripts/build.sh`.

## Global Constraints

- No build step and no runtime dependencies; tests run with `npm test` (`node --test "tests/*.test.js"`).
- Google scopes are exactly `openid`, `email`, `https://www.googleapis.com/auth/drive.file`. No client secret in the extension.
- Drive file name `Fetchwing data`, found again through `appProperties` `{ fetchwing: 'v1' }`.
- Merge: last edit wins per item (request, folder, collection, environment), compared by `updatedAt`. Deletes are tombstones (`deleted: true`) and are never removed.
- Variables marked **secret** never leave the device: uploaded with `value: ''`.
- Works offline; a failed round changes no local data.
- English UI. MIT licence. No Postman name or logo anywhere, and no "Postman clone" in the Store text.
- Mock on/off (`mock.enabled`) and the active environment (`activeEnvId`) stay per device (Claude's call: turning a mock on at work must not hijack a page at home).
- Shell commands in this repo are run with the `rtk` prefix; commit messages in English, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Two devices edit different requests while offline, then sync → both edits are kept on both devices (Task 1 test `keeps edits from both sides`).
2. A fresh install signs in to an account that already has Drive data → no second "My Collection" or "Local" appears (Task 1 test `pristine local adopts remote`).
3. The user deletes "Fetchwing data" in Drive → the next round makes a new file and uploads everything; nothing local is lost (Task 3 test `recreates a missing file`).
4. Signing in on a device that last synced another Google account, with local data → the user is asked before that data is merged into the new account (Task 3 test `asks before merging into a different account`).
5. An edit lands while a round is uploading → the edit is not overwritten by the round's result and is uploaded on the next round (Task 3 test `edit during a round survives`).

---

### Task 1: Merge rules

**Files:**
- Create: `src/lib/sync-merge.js`
- Test: `tests/sync-merge.test.js`

**Interfaces:**
- Consumes: workspace shape from `src/lib/model.js` (`{ items, environments, activeEnvId }`; every item and environment has `id`, `updatedAt`, `deleted`; environment vars are `{ key, value, secret }`; request items have `mock.enabled`).
- Produces:
  - `REMOTE_VERSION = 1`
  - `toRemote(ws) -> { version: 1, items, environments }` — deep copy with secret values set to `''`, every `mock.enabled` set to `false`, no `activeEnvId`.
  - `isPristine(ws) -> boolean` — true when every item and environment has `updatedAt === 0` (only the defaults from `emptyWorkspace()`).
  - `mergeRemote(local, remote) -> { workspace, upload: boolean }` — `remote` is a `toRemote` object or `null`. `upload` is true when the Drive copy is missing or older than local for any item or environment.

- [ ] **Step 1: Write the failing tests**

Helpers in the test build small workspaces by hand (`item(id, updatedAt, extra)`, `env(id, updatedAt, vars)`). Tests:

```js
test('keeps edits from both sides', () => {
  const local = ws({ a: item('a', 5, { name: 'A local' }), b: item('b', 1, { name: 'B old' }) });
  const remote = toRemote(ws({ a: item('a', 1, { name: 'A old' }), b: item('b', 7, { name: 'B remote' }) }));
  const { workspace, upload } = mergeRemote(local, remote);
  assert.equal(workspace.items.a.name, 'A local');
  assert.equal(workspace.items.b.name, 'B remote');
  assert.equal(upload, true);
});
test('later edit wins the whole item; tie keeps local', ...);           // updatedAt 9 vs 4 → 9; 4 vs 4 → local, upload false
test('items only on one side are kept', ...);                            // local-only → upload true; remote-only → added, upload false
test('tombstones win when newer and are kept', ...);                     // remote deleted:true @8 over local @3 → deleted stays in map
test('secret values never leave and survive a remote win', () => {
  const local = ws({}, { e: env('e', 2, [{ key: 'token', value: 's3cret', secret: true }, { key: 'base', value: 'x', secret: false }]) });
  assert.equal(toRemote(local).environments.e.vars[0].value, '');
  const remote = toRemote(ws({}, { e: env('e', 9, [{ key: 'token', value: '', secret: true }, { key: 'base', value: 'y', secret: false }]) }));
  const merged = mergeRemote(local, remote).workspace.environments.e.vars;
  assert.deepEqual(merged, [{ key: 'token', value: 's3cret', secret: true }, { key: 'base', value: 'y', secret: false }]);
});
test('mock on/off stays per device', ...);                               // toRemote sets enabled false; remote win keeps local enabled (true stays true, absent → false)
test('activeEnvId is local; falls back when its env is deleted', ...);   // remote deletes the active env @9 → activeEnvId = first live env id or null
test('pristine local adopts remote', () => {
  const local = emptyWorkspace();
  const remote = toRemote(ws({ c: item('c', 3, { type: 'collection', name: 'Shop' }) }, { e: env('e', 3, []) }));
  const { workspace, upload } = mergeRemote(local, remote);
  assert.deepEqual(Object.keys(workspace.items), ['c']);
  assert.deepEqual(Object.keys(workspace.environments), ['e']);
  assert.equal(workspace.activeEnvId, 'e');
  assert.equal(upload, false);
});
test('no remote file: upload everything', ...);                          // mergeRemote(local, null) → workspace deep-equals local, upload true
```

- [ ] **Step 2: Run tests, expect failure**

Run: `rtk npm test`
Expected: FAIL — `Cannot find module '../src/lib/sync-merge.js'`.

- [ ] **Step 3: Implement `src/lib/sync-merge.js`**

The merge goes per map (`items`, `environments`), id by id. The newer `updatedAt` wins, and a tie keeps local. When remote wins, carry over the local `mock.enabled` and local secret values (matched by var `key`). A pristine local with a non-null remote returns the remote contents as the workspace. Keep `activeEnvId` if it still points to a live env, else use the first live env by `order`, else `null`. Never mutate the inputs.

- [ ] **Step 4: Run tests, expect pass**

Run: `rtk npm test`
Expected: all pass.

- [ ] **Step 5: Commit** — `feat: add per-item merge rules for Drive sync`

---

### Task 2: Google sign-in and Drive file client

**Files:**
- Create: `src/config.js`, `src/lib/google-auth.js`, `src/lib/drive-store.js`
- Test: `tests/google-auth.test.js`, `tests/drive-store.test.js`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `src/config.js`: `GOOGLE_CLIENT_ID` (string; `''` until the publishing guide's step is done), `SCOPES`, `DRIVE_FILE_NAME = 'Fetchwing data'`, `APP_PROPERTY = { key: 'fetchwing', value: 'v1' }`.
  - `src/lib/google-auth.js`: the same exports as Sticky Notes Sync — `AuthRequired`, `DriveAccessMissing`, `buildAuthUrl`, `parseRedirect`, `createAuth({ identity, session, local, fetchFn, clientId, now }) -> { getToken, signIn, signOut, getAccount, invalidate }`. Copy the file and its test, then change only the config import. `signIn` returns `{ email, token }`; it does not store the account (the syncer does, under `local` key `account`).
  - `src/lib/drive-store.js`: `ApiError(status)`, `FileMissing`, `createDriveStore({ fetchFn, getToken, onUnauthorized }) -> { find(): Promise<string|null>, create(data): Promise<string>, read(fileId): Promise<object>, write(fileId, data): Promise<void> }`.

- [ ] **Step 1: Port `google-auth.js` and its test**

Copy both files from the reference repo. Point the import at `../config.js` and create `src/config.js` with the values above.

- [ ] **Step 2: Run tests, expect the ported auth tests to pass**

Run: `rtk npm test`
Expected: the new `google-auth` tests pass, and so do all existing tests.

- [ ] **Step 3: Write failing drive-store tests**

Use a fake `fetchFn` that records `[method, url, headers, body]` and replies from a queue. Tests:

```js
test('find queries by appProperties and ignores trashed files', ...);
// URL has q = "appProperties has { key='fetchwing' and value='v1' } and trashed=false", spaces=drive, fields=files(id)
// reply { files: [{ id: 'F1' }] } → 'F1'; reply { files: [] } → null
test('create uploads JSON with name and appProperties (multipart)', ...);
// POST https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id
// metadata part = { name: 'Fetchwing data', mimeType: 'application/json', appProperties: { fetchwing: 'v1' } }; returns id
test('read downloads alt=media and parses JSON', ...);                 // GET .../files/F1?alt=media
test('write replaces content', ...);                                    // PATCH https://www.googleapis.com/upload/drive/v3/files/F1?uploadType=media, body = JSON
test('404 on read or write throws FileMissing', ...);
test('401 calls onUnauthorized once and retries', ...);                 // second 401 → AuthRequired
test('403 with insufficient scope throws DriveAccessMissing; other errors ApiError(status)', ...);
```

- [ ] **Step 4: Run tests, expect failure**

Run: `rtk npm test`
Expected: FAIL — module `drive-store.js` not found.

- [ ] **Step 5: Implement `src/lib/drive-store.js`**

Use the reference `sheets-store.js` `request()` loop as the model: bearer token, 401 → `onUnauthorized()` then retry once, and the scope check via `isMissingScope`. Build the multipart body with a fixed boundary string.

- [ ] **Step 6: Run tests, expect pass**

Run: `rtk npm test`
Expected: all pass.

- [ ] **Step 7: Commit** — `feat: add Google sign-in and Drive file client`

---

### Task 3: Syncer

**Files:**
- Create: `src/lib/sync.js`
- Test: `tests/sync.test.js`

**Interfaces:**
- Consumes: `mergeRemote`, `toRemote`, `isPristine` (Task 1); `createAuth` errors and `createDriveStore` errors (Task 2).
- Produces: `createSyncer({ getWorkspace, updateWorkspace, setStatus, auth, store, local, now }) -> { round(), signIn({ forceConsent }), confirmAccount(choice), signOut() }`.
  - `getWorkspace(): Promise<ws>`. `updateWorkspace(fn: ws => ws): Promise<ws>` runs `fn` inside the worker's write queue.
  - `setStatus(patch)` merges into `{ state: 'off'|'syncing'|'ok'|'error'|'signin'|'drive'|'confirm', email, error, lastSyncAt }`.
  - `local` keys: `account` `{ email }`, `driveFile` `{ fileId, email }`, `lastSyncedEmail`.
  - `signIn` resolves `{ ok: true }` or `{ ok: false, confirm: { email, previousEmail } }`. `confirmAccount('merge' | 'replace' | 'cancel')`: `merge` keeps local data and merges it into the new account. `replace` sets the workspace to `emptyWorkspace()` before the first round, so it adopts Drive data as pristine. `cancel` signs out.

- [ ] **Step 1: Write failing tests** with in-memory fakes for auth, store, local storage and the workspace:

```js
test('signed out: round sets state off and touches nothing', ...);
test('first round with no file creates it from toRemote(local)', ...);       // store.create called once with toRemote(ws); local.driveFile = { fileId, email }
test('round merges remote and uploads only when needed', ...);              // remote newer only → no write; local newer → one write of toRemote(merged)
test('edit during a round survives', async () => {
  // store.read resolves after the test runs updateWorkspace to rename item 'a' (updatedAt 50)
  // after the round, workspace.items.a has the new name, and status.state is 'ok'
  // the next round writes it (store.write called with name from the edit)
});
test('recreates a missing file', ...);                                        // read throws FileMissing → create(toRemote(local)) → local.driveFile updated, state ok
test('offline keeps local data and reports error', ...);                     // read throws TypeError → workspace unchanged, state 'error', error "Can't reach Google"
test('auth errors map to signin / drive states', ...);                       // AuthRequired → 'signin', "Please sign in again"; DriveAccessMissing → 'drive', "Allow Google Drive access to sync"
test('asks before merging into a different account', async () => {
  // lastSyncedEmail 'a@x.com', local not pristine, signIn returns b@x.com
  // → { ok: false, confirm: { email: 'b@x.com', previousEmail: 'a@x.com' } }, status state 'confirm', no store calls
  // confirmAccount('replace') → workspace adopts remote; confirmAccount('merge') → merged; 'cancel' → signed out, local untouched
});
test('rounds never overlap; a request during a round runs one more', ...);
test('signOut runs a last round, then clears account and driveFile; local data kept', ...);
```

- [ ] **Step 2: Run tests, expect failure**

Run: `rtk npm test`
Expected: FAIL — module `sync.js` not found.

- [ ] **Step 3: Implement `src/lib/sync.js`**

A round does the following, in order:
1. `getToken({ interactive: false })`.
2. Ensure the file: if `driveFile.email` matches the account, use it; else `find()`, and if nothing is found, `create(toRemote(ws))`.
3. `read()`.
4. Apply the merge as `updateWorkspace(current => mergeRemote(current, remote).workspace)`. Merging against the current workspace inside the queue is what keeps edits made during the round.
5. If the merge reported `upload`, `write(fileId, toRemote(result))`.
6. Set `lastSyncedEmail`, then status `ok` with `lastSyncAt`.

Error messages are copied from the reference `describe()`. Use one `running` promise plus an `again` flag, as in the reference syncer.

- [ ] **Step 4: Run tests, expect pass**

Run: `rtk npm test`
Expected: all pass.

- [ ] **Step 5: Commit** — `feat: add Drive syncer with account-switch confirmation`

---

### Task 4: Worker wiring and manifest

**Files:**
- Modify: `manifest.json`, `src/background.js`

**Interfaces:**
- Consumes: `createAuth` (Task 2), `createDriveStore` (Task 2), `createSyncer` (Task 3), `GOOGLE_CLIENT_ID` (Task 2).
- Produces messages for the panel: `syncSignIn { forceConsent? }` → `{ ok } | { ok:false, confirm } | { ok:false, error }`; `syncConfirm { choice }`; `syncSignOut`; `syncNow`. Status lives in `chrome.storage.local` key `syncStatus`, so the panel reads it through `storage.onChanged`.

- [ ] **Step 1: Manifest**

Add `"identity"` and `"alarms"` to `permissions`. Add `host_permissions`: `https://www.googleapis.com/*`, `https://openidconnect.googleapis.com/*`, `https://oauth2.googleapis.com/*`. Add `icons` and `action.default_icon`, which point at Task 6's files; until then, keep the keys out.

- [ ] **Step 2: Wire the syncer in `src/background.js`**

- Build auth with `chrome.identity`, `chrome.storage.session` and `chrome.storage.local`.
- Build the store with `onUnauthorized: auth.invalidate`.
- Build the syncer:
  - `updateWorkspace` uses the existing `enqueue` + `loadWorkspace` + `storage.local.set` path, then `publishMocks`.
  - `setStatus` merges into `syncStatus`.
- When to run a round:
  - 3 s after the last successful `mutate` (debounced with `setTimeout`).
  - On the `fw-sync` alarm (`periodInMinutes: 5`).
  - On `runtime.onStartup`.
  - On `syncNow`.
- When `GOOGLE_CLIENT_ID` is `''`, `syncSignIn` returns `{ ok: false, error: 'Sync is not set up in this build' }` and no round runs.

- [ ] **Step 3: Verify existing behaviour still works**

Run: `rtk npm test`, then the e2e harness `fw-e2e2.mjs` from the redesign plan.
Expected: all tests pass; e2e prints `no page errors`, and the mock/send lines match the redesign run.

- [ ] **Step 4: Commit** — `feat: run Drive sync from the service worker`

---

### Task 5: Sync control in the panel

**Files:**
- Modify: `src/panel/panel.html` (button `#syncBtn` before `#themeBtn`), `src/panel/panel.js`, `src/panel/ui.js` (icons `cloud`, `cloudOff`), `src/panel/panel.css`

**Interfaces:**
- Consumes: Task 4 messages and `syncStatus`.
- Produces: nothing for later tasks.

- [ ] **Step 1: Button states.** The button is `.icon-btn` with `data-state` set from `syncStatus.state`:
  - `off` → `cloudOff` icon, muted.
  - `syncing` → `cloud` icon with a pulse animation, which respects reduced motion.
  - `ok` → `cloud` icon.
  - `error`, `signin`, `drive`, `confirm` → `cloud` icon plus an `--err` dot.
  - `aria-label`/`title` read `Sync: off`, `Sync: up to date (synced 2 min ago)`, or `Sync: <error>`.
- [ ] **Step 2: Menu** (`showMenu` under the button). Items by state:
  - Signed out: `Sign in with Google` → `syncSignIn`.
  - Signed in: the email (a disabled row), `Sync now`, `Sign out`.
  - `drive`: `Allow Drive access` → `syncSignIn { forceConsent: true }`.
  - `signin`: `Sign in again`.
  - `error`: the error text plus `Retry`.
- [ ] **Step 3: Account-switch dialog.** When `syncSignIn` returns `confirm`, open a dialog:
  - Title: `Sync with <email>?`
  - Text: `This device last synced with <previousEmail>.`
  - Buttons: `Merge this device's data`, `Use <email>'s data`, `Cancel` → `syncConfirm`.
- [ ] **Step 4: Verify in Chromium** with an e2e script that sets `syncStatus` through the service worker for each state.
  - Expected: the icon, label and menu items match Steps 1–2.
  - Expected: with the build's empty client ID, clicking `Sign in with Google` shows the toast `Sync is not set up in this build`.
  - Expected: no page errors.
  - Save screenshots `sync-off.png`, `sync-ok.png`, `sync-error.png` in the scratchpad.
- [ ] **Step 5: Commit** — `feat: add sync button and account menu to the panel`

---

### Task 6: Store readiness

**Files:**
- Create: `assets/icon.svg`, `assets/icons/icon-{16,32,48,128}.png`, `LICENSE`, `README.md`, `docs/index.html`, `docs/privacy.html`, `docs/COMPLIANCE.md`, `docs/PUBLISHING.md`, `docs/store/` (screenshots 1280×800, small promo tile 440×280), `scripts/build.sh`
- Modify: `manifest.json` (`version` `1.0.0`, `icons`, `action.default_icon`, `homepage_url` `https://hduy-dev.github.io/fetchwing/`)

- [ ] **Step 1: Icons.** `assets/icon.svg` is the panel's teal logo mark (gradient `#2dd4bf → #0f766e` rounded square, white wing stroke from `ICONS.logo`). Render the PNGs at 16/32/48/128 with headless Chromium from a scratchpad script; commit only the PNGs and the SVG.
- [ ] **Step 2: `LICENSE`** (MIT, `Copyright (c) 2026 HDuy-Dev`). **`README.md`** covers: what it is, the main features (Paste/Import cURL, collections, environments and secrets, mocks that keep working with DevTools closed, Drive sync), install from the Store or load unpacked, the privacy summary with a link, and the licence. No Postman mention.
- [ ] **Step 3: `docs/privacy.html` and `docs/index.html`.** Same structure as the reference repo, in the teal palette. The privacy policy states:
  - Data is stored in `chrome.storage.local`, and in the user's own Drive file `Fetchwing data` only when they sign in.
  - Scopes: `openid`, `email`, `drive.file`.
  - Secret variables are never uploaded.
  - Requests go only to URLs the user sends to.
  - Site access is asked for per site.
  - On sites where mocks run, page scripts can read the list of active mocks (method, URL, status, headers, body).
  - No analytics, no selling of data. How to delete: sign out and delete the Drive file; remove the extension.
  - Contact: the GitHub issues link.
- [ ] **Step 4: `docs/COMPLIANCE.md`.** A table with one justification line per permission: `storage`, `scripting`, `declarativeNetRequestWithHostAccess`, `clipboardRead`, `identity`, `alarms`, the optional host permissions, and the Google API hosts. Also: single purpose, remote code (none), data use (matching the privacy page), brand check (no Postman name, logo or look).
- [ ] **Step 5: `docs/PUBLISHING.md`**, modelled on the reference guide's sections 1–5 plus listing text:
  1. Create the Store item by uploading the zip from `scripts/build.sh`. Copy the public key into `manifest.json` `key` so the ID is stable.
  2. Google Cloud: a new project, the OAuth consent screen with the three scopes (`drive.file` is non-sensitive, so no verification), and a Web-application client with redirect `https://<extension-id>.chromiumapp.org/`. Paste the client ID into `src/config.js`.
  3. Test sign-in.
  4. Fill in the Store listing: privacy URL `https://hduy-dev.github.io/fetchwing/privacy.html`, the permission justifications from COMPLIANCE.md, and the screenshots.
  5. Pages: serve from `main` `/docs`.

  Include a short description of at most 132 characters, and a long description.
- [ ] **Step 6: `scripts/build.sh`** zips `manifest.json`, `src/`, `assets/icons/` into `dist/fetchwing-<version>.zip`. It excludes `src/**/*.test.js`, `docs/`, `mockup/`, `tests/`, `scripts/` and `.superpowers/`. Add `dist/` to `.gitignore`.
- [ ] **Step 7: Store images.** Use the e2e harness at a 1280×800 viewport, dark theme: (a) response with JSON, (b) mock pane on, (c) Mocks section, (d) light theme. Render a 440×280 promo tile from `assets/icon.svg` plus the word "Fetchwing". Save them in `docs/store/`.
- [ ] **Step 8: Verify**
  - Run: `rtk npm test` → all pass.
  - Run: `sh scripts/build.sh && unzip -l dist/fetchwing-1.0.0.zip` → it lists `manifest.json`, `src/…`, `assets/icons/…` and nothing from docs, tests or mockup.
  - Load the unpacked build in Chromium → it loads with no errors, and the icon shows in the toolbar and on the DevTools tab.
- [ ] **Step 9: Commit** — `chore: prepare Fetchwing 1.0.0 for the Chrome Web Store`

---

## Manual steps for the user (after merge)

These need the user's Google and Store accounts, so `docs/PUBLISHING.md` walks through them:
1. Create the Fetchwing item in the Web Store Developer Dashboard, upload the zip, and copy the public key and item ID.
2. Create the Google Cloud project, consent screen and OAuth client, then send the client ID back so it can be put into `src/config.js` and `key` into the manifest.
3. Turn on GitHub Pages from `/docs`.
4. Fill in the listing and submit for review.
