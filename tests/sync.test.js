import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSyncer } from '../src/lib/sync.js';
import { toRemote } from '../src/lib/sync-merge.js';
import { emptyWorkspace, newRequest } from '../src/lib/model.js';
import { AuthRequired, DriveAccessMissing } from '../src/lib/google-auth.js';
import { FileMissing } from '../src/lib/drive-store.js';

const item = (id, updatedAt, extra = {}) => ({ id, type: 'request', parentId: 'c', order: 0, name: id, updatedAt, deleted: false, ...newRequest(), ...extra });
const ws = items => ({ items, environments: {}, activeEnvId: null });

function memoryArea(initial = {}) {
  const data = { ...initial };
  return {
    data,
    get: async key => (key in data ? { [key]: data[key] } : {}),
    set: async obj => { Object.assign(data, obj); },
    remove: async keys => { for (const k of [].concat(keys)) delete data[k]; },
  };
}

function harness({ workspace = ws({ a: item('a', 5) }), account = { email: 'me@x.com' }, files = {}, local = {}, signInEmail = 'me@x.com' } = {}) {
  const state = { ws: workspace, status: {} };
  const calls = [];
  const area = memoryArea({ ...(account ? { account } : {}), ...local });
  let nextId = 1;
  const store = {
    files,
    find: async () => { calls.push(['find']); return Object.keys(files)[0] ?? null; },
    create: async data => { const id = `F${nextId++}`; files[id] = structuredClone(data); calls.push(['create', id]); return id; },
    read: async id => { calls.push(['read', id]); if (store.readHook) await store.readHook(); if (store.readError) throw store.readError; if (!files[id]) throw new FileMissing('gone'); return structuredClone(files[id]); },
    write: async (id, data) => { calls.push(['write', id]); if (!files[id]) throw new FileMissing('gone'); files[id] = structuredClone(data); },
  };
  const auth = {
    tokenError: null,
    getAccount: async () => area.data.account ?? null,
    getToken: async () => { if (auth.tokenError) throw auth.tokenError; return 'T'; },
    signIn: async () => ({ email: signInEmail, token: 'T' }),
    signOut: async () => { calls.push(['authSignOut']); await area.remove('account'); },
  };
  const syncer = createSyncer({
    getWorkspace: async () => state.ws,
    updateWorkspace: async fn => { state.ws = fn(state.ws); return state.ws; },
    setStatus: async patch => { state.status = { ...state.status, ...patch }; },
    auth, store, local: area, now: () => 1234,
  });
  return { syncer, state, calls, store, auth, area };
}

test('signed out: round sets state off and touches nothing', async () => {
  const h = harness({ account: null });
  const before = h.state.ws;
  await h.syncer.round();
  assert.equal(h.state.status.state, 'off');
  assert.equal(h.state.ws, before);
  assert.deepEqual(h.calls, []);
});

test('first round with no file creates it from toRemote(local)', async () => {
  const h = harness();
  await h.syncer.round();
  assert.deepEqual(h.calls.map(c => c[0]), ['find', 'create']);
  assert.deepEqual(h.store.files.F1, toRemote(h.state.ws));
  assert.deepEqual(h.area.data.driveFile, { fileId: 'F1', email: 'me@x.com' });
  assert.equal(h.state.status.state, 'ok');
  assert.equal(h.state.status.lastSyncAt, 1234);
  assert.equal(h.area.data.lastSyncedEmail, 'me@x.com');
});

test('round merges remote and uploads only when needed', async () => {
  const remoteNewer = harness({ files: { R: toRemote(ws({ a: item('a', 9, { name: 'remote' }) })) }, local: { driveFile: { fileId: 'R', email: 'me@x.com' } } });
  await remoteNewer.syncer.round();
  assert.equal(remoteNewer.state.ws.items.a.name, 'remote');
  assert.deepEqual(remoteNewer.calls.map(c => c[0]), ['read']);

  const localNewer = harness({ workspace: ws({ a: item('a', 9, { name: 'local' }) }), files: { R: toRemote(ws({ a: item('a', 2) })) }, local: { driveFile: { fileId: 'R', email: 'me@x.com' } } });
  await localNewer.syncer.round();
  assert.deepEqual(localNewer.calls.map(c => c[0]), ['read', 'write']);
  assert.equal(localNewer.store.files.R.items.a.name, 'local');
});

test('edit during a round survives', async () => {
  const h = harness({ files: { R: toRemote(ws({ a: item('a', 5) })) }, local: { driveFile: { fileId: 'R', email: 'me@x.com' } } });
  h.store.readHook = async () => {
    h.store.readHook = null;
    h.state.ws = ws({ a: item('a', 50, { name: 'edited' }) });
  };
  await h.syncer.round();
  assert.equal(h.state.ws.items.a.name, 'edited');
  assert.equal(h.state.status.state, 'ok');
  await h.syncer.round();
  assert.equal(h.store.files.R.items.a.name, 'edited');
});

test('recreates a missing file', async () => {
  const h = harness({ files: {}, local: { driveFile: { fileId: 'GONE', email: 'me@x.com' } } });
  await h.syncer.round();
  assert.deepEqual(h.calls.map(c => c[0]), ['read', 'find', 'create']);
  assert.equal(h.area.data.driveFile.fileId, 'F1');
  assert.deepEqual(h.store.files.F1, toRemote(h.state.ws));
  assert.ok(h.state.ws.items.a);
  assert.equal(h.state.status.state, 'ok');
});

test('offline keeps local data and reports error', async () => {
  const h = harness({ files: { R: toRemote(ws({})) }, local: { driveFile: { fileId: 'R', email: 'me@x.com' } } });
  h.store.readError = new TypeError('Failed to fetch');
  const before = h.state.ws;
  await h.syncer.round();
  assert.equal(h.state.ws, before);
  assert.equal(h.state.status.state, 'error');
  assert.equal(h.state.status.error, "Can't reach Google");
});

test('a file that is not Fetchwing data is never overwritten', async () => {
  const h = harness({ files: { R: { hello: 1 } }, local: { driveFile: { fileId: 'R', email: 'me@x.com' } } });
  await h.syncer.round();
  assert.equal(h.state.status.state, 'error');
  assert.deepEqual(h.store.files.R, { hello: 1 });
});

test('auth errors map to signin / drive states', async () => {
  const h = harness();
  h.auth.tokenError = new AuthRequired('x');
  await h.syncer.round();
  assert.deepEqual([h.state.status.state, h.state.status.error], ['signin', 'Please sign in again']);
  h.auth.tokenError = new DriveAccessMissing('x');
  await h.syncer.round();
  assert.deepEqual([h.state.status.state, h.state.status.error], ['drive', 'Allow Google Drive access to sync']);
});

test('asks before merging into a different account', async () => {
  const setup = () => harness({
    account: null, signInEmail: 'b@x.com',
    workspace: ws({ mine: item('mine', 4) }),
    files: { B: toRemote(ws({ theirs: item('theirs', 6) })) },
    local: { lastSyncedEmail: 'a@x.com' },
  });

  const ask = setup();
  const res = await ask.syncer.signIn();
  assert.deepEqual(res, { ok: false, confirm: { email: 'b@x.com', previousEmail: 'a@x.com' } });
  assert.equal(ask.state.status.state, 'confirm');
  assert.deepEqual(ask.calls, []);

  const replace = setup();
  await replace.syncer.signIn();
  await replace.syncer.confirmAccount('replace');
  await replace.syncer.round();
  assert.deepEqual(Object.keys(replace.state.ws.items), ['theirs']);

  const merge = setup();
  await merge.syncer.signIn();
  await merge.syncer.confirmAccount('merge');
  await merge.syncer.round();
  assert.deepEqual(Object.keys(merge.state.ws.items).sort(), ['mine', 'theirs']);
  assert.ok(merge.store.files.B.items.mine);

  const cancel = setup();
  const before = cancel.state.ws;
  await cancel.syncer.signIn();
  await cancel.syncer.confirmAccount('cancel');
  assert.equal(cancel.state.ws, before);
  assert.equal(cancel.area.data.account, undefined);
  assert.equal(cancel.state.status.state, 'off');
});

test('same account or pristine data signs in without asking', async () => {
  const h = harness({ account: null, signInEmail: 'a@x.com', workspace: emptyWorkspace(), local: { lastSyncedEmail: 'b@x.com' } });
  assert.deepEqual(await h.syncer.signIn(), { ok: true });
  assert.deepEqual(h.area.data.account, { email: 'a@x.com' });
});

test('rounds never overlap; a request during a round runs one more', async () => {
  const h = harness({ files: { R: toRemote(ws({})) }, local: { driveFile: { fileId: 'R', email: 'me@x.com' } } });
  let release;
  h.store.readHook = () => new Promise(r => { release = r; });
  const first = h.syncer.round();
  await new Promise(r => setTimeout(r));
  const second = h.syncer.round();
  const third = h.syncer.round();
  h.store.readHook = null;
  release();
  await Promise.all([first, second, third]);
  assert.equal(h.calls.filter(c => c[0] === 'read').length, 2);
});

test('signOut runs a last round, then clears account and driveFile; local data kept', async () => {
  const h = harness({ workspace: ws({ a: item('a', 9, { name: 'unsynced' }) }), files: { R: toRemote(ws({ a: item('a', 1) })) }, local: { driveFile: { fileId: 'R', email: 'me@x.com' } } });
  await h.syncer.signOut();
  assert.equal(h.store.files.R.items.a.name, 'unsynced');
  assert.equal(h.area.data.account, undefined);
  assert.equal(h.area.data.driveFile, undefined);
  assert.equal(h.state.ws.items.a.name, 'unsynced');
  assert.equal(h.state.status.state, 'off');
});

test('missing Drive permission on sign-in asks to allow it', async () => {
  const h = harness({ account: null });
  h.auth.signIn = async () => { throw new DriveAccessMissing('no drive'); };
  assert.deepEqual(await h.syncer.signIn(), { ok: false, needsDrive: true });
  assert.equal(h.state.status.state, 'drive');
  assert.equal(h.area.data.account, undefined);
  assert.deepEqual(h.calls, []);
  // Ticking the box the second time signs in normally.
  let forced;
  h.auth.signIn = async ({ forceConsent }) => { forced = forceConsent; return { email: 'me@x.com', token: 'T' }; };
  assert.deepEqual(await h.syncer.signIn({ forceConsent: true }), { ok: true });
  assert.equal(forced, true);
  assert.deepEqual(h.area.data.account, { email: 'me@x.com' });
});
