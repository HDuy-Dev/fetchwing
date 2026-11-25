import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorkspace, applyMutation, children } from '../src/lib/model.js';
import { deriveActiveMocks } from '../src/lib/mocks.js';
import { popupView, siteStep } from '../src/lib/popup-model.js';

function workspace() {
  let ws = emptyWorkspace();
  const c = children(ws, null)[0].id;
  const run = m => { ws = applyMutation(ws, m, 1).workspace; };
  run({ type: 'updateEnvironment', id: ws.activeEnvId, patch: { vars: [{ key: 'base', value: 'http://localhost:3000' }] } });
  run({ type: 'addItem', id: 'a', itemType: 'request', parentId: c, name: 'Users', fields: { url: '{{base}}/api/users' } });
  run({ type: 'addItem', id: 'c', itemType: 'request', parentId: c, name: 'Missing var', fields: { url: '{{nope}}/x' } });
  run({ type: 'addItem', id: 'd', itemType: 'request', parentId: c, name: 'No mock', fields: { url: 'http://x.test' } });
  run({ type: 'updateMock', id: 'a', patch: { status: 500, body: '{}' } });
  run({ type: 'setMockEnabled', id: 'c', enabled: true });
  return { get ws() { return ws; }, run };
}

const view = (w, ctx = {}) => popupView(w.ws, { mockSites: [], tabOrigin: null, hasAccess: false, ...ctx });
const row = (v, id) => v.rows.find(r => r.id === id);

test('lists every request in tree order, whether its mock is on or off', () => {
  const w = workspace();
  const collection = children(w.ws, null)[0].id;
  w.run({ type: 'addItem', id: 'f', itemType: 'folder', parentId: collection, name: 'Folder' });
  w.run({ type: 'addItem', id: 'e', itemType: 'request', parentId: 'f', name: 'In folder', fields: { url: 'http://x.test/e' } });
  w.run({ type: 'moveItem', id: 'f', parentId: collection, order: 0 });
  assert.deepEqual(view(w).rows.map(r => r.id), ['e', 'a', 'c', 'd']);
  w.run({ type: 'setMockEnabled', id: 'a', enabled: true });
  w.run({ type: 'disableAllMocks' });
  assert.deepEqual(view(w).rows.map(r => r.id), ['e', 'a', 'c', 'd']);
  w.run({ type: 'deleteItem', id: 'f' });
  assert.deepEqual(view(w).rows.map(r => r.id), ['a', 'c', 'd']);
});

test('url is resolved without scheme; unresolved keeps raw url and lists missing', () => {
  const v = view(workspace());
  assert.deepEqual(row(v, 'a'), { id: 'a', method: 'GET', name: 'Users', url: 'localhost:3000/api/users', status: 500, enabled: false, missing: [] });
  assert.deepEqual(row(v, 'c').missing, ['nope']);
  assert.equal(row(v, 'c').url, '{{nope}}/x');
});

test('counts match the badge', () => {
  const w = workspace();
  w.run({ type: 'setMockEnabled', id: 'a', enabled: true });
  const v = view(w);
  assert.equal(v.liveCount, 1);
  assert.equal(v.liveCount, deriveActiveMocks(w.ws).length);
  assert.equal(v.idleCount, 1);
  assert.equal(v.envName, 'Local');
  w.run({ type: 'setActiveEnv', id: null });
  assert.equal(view(w).envName, 'No environment');
});

test('banner and active site', () => {
  const o = 'http://shop.local:5173';
  const w = workspace();
  const flags = ctx => { const v = view(w, ctx); return [v.siteActive, v.showBanner]; };
  assert.deepEqual(flags({ tabOrigin: o }), [false, false]); // nothing live yet
  w.run({ type: 'setMockEnabled', id: 'a', enabled: true });
  assert.deepEqual(flags({ tabOrigin: o }), [false, true]);
  assert.deepEqual(flags({ tabOrigin: o, mockSites: [o], hasAccess: true }), [true, false]);
  assert.deepEqual(flags({ tabOrigin: o, mockSites: [o], hasAccess: false }), [false, true]);
  assert.deepEqual(flags({ tabOrigin: null }), [false, false]);
  assert.deepEqual(flags({ tabOrigin: 'chrome://extensions' }), [false, false]);
});

test('siteStep decides what turning a mock on needs', () => {
  const o = 'http://a.test';
  assert.equal(siteStep({ origin: null, mockSites: [], hasAccess: false }), 'none');
  assert.equal(siteStep({ origin: 'null', mockSites: [], hasAccess: false }), 'none');
  assert.equal(siteStep({ origin: 'chrome://newtab', mockSites: [], hasAccess: false }), 'none');
  assert.equal(siteStep({ origin: o, mockSites: [o], hasAccess: true }), 'none');
  assert.equal(siteStep({ origin: o, mockSites: [], hasAccess: true }), 'add');
  assert.equal(siteStep({ origin: o, mockSites: [o], hasAccess: false }), 'grant');
  assert.equal(siteStep({ origin: o, mockSites: [], hasAccess: false }), 'grant');
});
