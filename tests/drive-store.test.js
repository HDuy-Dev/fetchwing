import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDriveStore, ApiError, FileMissing } from '../src/lib/drive-store.js';
import { AuthRequired, DriveAccessMissing } from '../src/lib/google-auth.js';

const reply = (status, body) => ({ status, ok: status < 400, json: async () => body, text: async () => JSON.stringify(body) });

function harness(replies) {
  const calls = [];
  let unauthorized = 0;
  const store = createDriveStore({
    fetchFn: async (url, init = {}) => { calls.push({ url, method: init.method ?? 'GET', headers: init.headers, body: init.body }); return replies.shift(); },
    getToken: async () => 'TOKEN',
    onUnauthorized: async () => { unauthorized++; },
  });
  return { store, calls, unauthorized: () => unauthorized };
}

test('find queries by appProperties and ignores trashed files', async () => {
  const h = harness([reply(200, { files: [{ id: 'F1' }] }), reply(200, { files: [] })]);
  assert.equal(await h.store.find(), 'F1');
  assert.equal(await h.store.find(), null);
  const url = new URL(h.calls[0].url);
  assert.equal(url.origin + url.pathname, 'https://www.googleapis.com/drive/v3/files');
  assert.equal(url.searchParams.get('q'), "appProperties has { key='fetchwing' and value='v1' } and trashed=false");
  assert.equal(url.searchParams.get('spaces'), 'drive');
  assert.equal(url.searchParams.get('fields'), 'files(id)');
  assert.equal(h.calls[0].headers.Authorization, 'Bearer TOKEN');
});

test('create uploads JSON with name and appProperties (multipart)', async () => {
  const h = harness([reply(200, { id: 'NEW' })]);
  assert.equal(await h.store.create({ version: 1, items: {} }), 'NEW');
  const c = h.calls[0];
  assert.equal(c.method, 'POST');
  assert.equal(c.url, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id');
  assert.match(c.headers['Content-Type'], /^multipart\/related; boundary=/);
  const parts = c.body.split(/--\S+/).map(p => p.trim()).filter(p => p && p !== '--');
  const json = parts.map(p => JSON.parse(p.slice(p.indexOf('{'))));
  assert.deepEqual(json[0], { name: 'Fetchwing data', mimeType: 'application/json', appProperties: { fetchwing: 'v1' } });
  assert.deepEqual(json[1], { version: 1, items: {} });
});

test('read downloads alt=media and parses JSON', async () => {
  const h = harness([reply(200, { version: 1 })]);
  assert.deepEqual(await h.store.read('F1'), { version: 1 });
  assert.equal(h.calls[0].url, 'https://www.googleapis.com/drive/v3/files/F1?alt=media');
});

test('write replaces content', async () => {
  const h = harness([reply(200, { id: 'F1' })]);
  await h.store.write('F1', { version: 1, items: { a: 1 } });
  assert.equal(h.calls[0].method, 'PATCH');
  assert.equal(h.calls[0].url, 'https://www.googleapis.com/upload/drive/v3/files/F1?uploadType=media');
  assert.equal(h.calls[0].headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(h.calls[0].body), { version: 1, items: { a: 1 } });
});

test('404 on read or write throws FileMissing', async () => {
  const h = harness([reply(404, {}), reply(404, {})]);
  await assert.rejects(h.store.read('F1'), FileMissing);
  await assert.rejects(h.store.write('F1', {}), FileMissing);
});

test('401 calls onUnauthorized once and retries', async () => {
  const ok = harness([reply(401, {}), reply(200, { version: 1 })]);
  assert.deepEqual(await ok.store.read('F1'), { version: 1 });
  assert.equal(ok.unauthorized(), 1);
  const bad = harness([reply(401, {}), reply(401, {})]);
  await assert.rejects(bad.store.read('F1'), AuthRequired);
  assert.equal(bad.unauthorized(), 1);
});

test('403 with insufficient scope throws DriveAccessMissing; other errors ApiError(status)', async () => {
  const scope = harness([reply(403, { error: { errors: [{ reason: 'insufficientPermissions' }] } })]);
  await assert.rejects(scope.store.find(), DriveAccessMissing);
  const other = harness([reply(500, {})]);
  await assert.rejects(other.store.find(), err => err instanceof ApiError && err.status === 500);
});
