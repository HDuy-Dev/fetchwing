import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorkspace, applyMutation, children } from '../src/lib/model.js';
import { deriveActiveMocks } from '../src/lib/mocks.js';
import { popupView, siteStep, filterRows, matchRanges, displayUrl } from '../src/lib/popup-model.js';

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
  assert.deepEqual(row(v, 'a'), { id: 'a', method: 'GET', name: 'Users', url: 'localhost:3000/api/users', shortUrl: '/api/users', status: 500, path: 'My Collection', enabled: false, missing: [], problem: null });
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

test('a request whose folder was deleted by sync stays listed, so its running mock can be seen and turned off', () => {
  const w = workspace();
  const collection = children(w.ws, null)[0].id;
  w.run({ type: 'addItem', id: 'f', itemType: 'folder', parentId: collection, name: 'Folder' });
  w.run({ type: 'addItem', id: 'o', itemType: 'request', parentId: 'f', name: 'Orphan', fields: { url: 'http://x.test/o' } });
  w.run({ type: 'setMockEnabled', id: 'o', enabled: true });
  // Sync can keep a newer request while its folder arrives deleted from another device.
  const ws = { ...w.ws, items: { ...w.ws.items, f: { ...w.ws.items.f, deleted: true } } };
  const v = popupView(ws, { mockSites: [], tabOrigin: null, hasAccess: false });
  assert.deepEqual(v.rows.map(r => r.id), ['a', 'c', 'd', 'o']);
  assert.equal(v.liveCount, 1);
  assert.equal(v.idleCount, 1);
});

test('rows carry the collection and folder path', () => {
  const w = workspace();
  const collection = children(w.ws, null)[0].id;
  w.run({ type: 'addItem', id: 'f', itemType: 'folder', parentId: collection, name: 'Folder' });
  w.run({ type: 'addItem', id: 'e', itemType: 'request', parentId: 'f', name: 'In folder', fields: { url: 'http://x.test/e' } });
  assert.equal(row(view(w), 'e').path, 'My Collection / Folder');
  assert.equal(row(view(w), 'a').path, 'My Collection');
});

test('filterRows matches every word against method, name, url and path, ignoring case', () => {
  const rows = [
    { id: '1', method: 'GET', name: 'List users', url: 'api.example.com/users', path: 'Shop API' },
    { id: '2', method: 'POST', name: 'Create order', url: 'api.example.com/orders', path: 'Shop API / Orders' },
    { id: '3', method: 'POST', name: 'Create order', url: 'staging.example.com/orders', path: 'Staging / Orders' },
  ];
  const ids = q => filterRows(rows, q).map(r => r.id);
  assert.deepEqual(ids(''), ['1', '2', '3']);
  assert.deepEqual(ids('   '), ['1', '2', '3']);
  assert.deepEqual(ids('ORDER'), ['2', '3']);
  assert.deepEqual(ids('post staging'), ['3']);
  assert.deepEqual(ids('get'), ['1']);
  assert.deepEqual(ids('shop orders'), ['2']);
  assert.deepEqual(ids('invoice'), []);
  assert.deepEqual(ids('(.*['), []);
});

test('matchRanges finds every match, merged and in order', () => {
  assert.deepEqual(matchRanges('Order orders', 'order'), [[0, 5], [6, 11]]);
  assert.deepEqual(matchRanges('abc', 'b c'), [[1, 3]]);
  assert.deepEqual(matchRanges('aaaa', 'aa'), [[0, 4]]);
  assert.deepEqual(matchRanges('a.*b', '.*'), [[1, 3]]);
  assert.deepEqual(matchRanges('abc', ''), []);
  assert.deepEqual(matchRanges('abc', 'x'), []);
});

test('rows say why a mock cannot run', () => {
  const w = workspace();
  const collection = children(w.ws, null)[0].id;
  w.run({ type: 'addItem', id: 'n', itemType: 'request', parentId: collection, name: 'No url' });
  const v = view(w);
  assert.equal(row(v, 'c').problem, 'Not running · Unresolved variable: nope');
  assert.equal(row(v, 'n').problem, 'Not running · No URL');
  assert.equal(row(v, 'a').problem, null);
});

test('filterRows searches the problem text shown instead of the url', () => {
  const rows = [
    { id: '1', method: 'GET', name: 'A', url: '{{nope}}/x', path: '', problem: 'Not running · Unresolved variable: nope' },
    { id: '2', method: 'GET', name: 'B', url: 'api.test/x', path: '', problem: null },
  ];
  assert.deepEqual(filterRows(rows, 'not running').map(r => r.id), ['1']);
  assert.deepEqual(filterRows(rows, '{{').map(r => r.id), []);
});

test('matchRanges keeps positions when lowercasing changes the length', () => {
  assert.deepEqual(matchRanges('İstanbul', 'stan'), [[1, 5]]);
  assert.deepEqual(matchRanges('Café İ', 'café'), [[0, 4]]);
});

test('a request left in a deleted folder has no folder path', () => {
  const w = workspace();
  const collection = children(w.ws, null)[0].id;
  w.run({ type: 'addItem', id: 'f', itemType: 'folder', parentId: collection, name: 'Gone' });
  w.run({ type: 'addItem', id: 'o', itemType: 'request', parentId: 'f', name: 'Orphan', fields: { url: 'http://x.test/o' } });
  const ws = { ...w.ws, items: { ...w.ws.items, f: { ...w.ws.items.f, deleted: true } } };
  const v = popupView(ws, { mockSites: [], tabOrigin: null, hasAccess: false });
  assert.equal(v.rows.find(r => r.id === 'o').path, '');
  assert.deepEqual(filterRows(v.rows, 'gone'), []);
});


test('Greek final sigma matches either case', () => {
  assert.deepEqual(matchRanges('ΟΔΟΣ', 'οδος'), [[0, 4]]);
  assert.deepEqual(matchRanges('οδος', 'ΟΔΟΣ'), [[0, 4]]);
});

function rowsFor(requests) {
  let ws = emptyWorkspace();
  const parentId = children(ws, null)[0].id;
  requests.forEach(([url, method = 'GET'], i) => {
    ws = applyMutation(ws, { type: 'addItem', id: `r${i}`, itemType: 'request', parentId, name: `R${i}`, fields: { url, method } }, 1).workspace;
  });
  return popupView(ws, { mockSites: [], tabOrigin: null, hasAccess: false }).rows;
}
const shortUrls = requests => rowsFor(requests).map(r => r.shortUrl);

test('short url drops the host and keeps path, query and fragment', () => {
  assert.deepEqual(
    shortUrls([['https://api.x.test/a/b?page=1#top'], ['https://api.x.test'], ['https://api.x.test/'], ['api.x.test?q=1'], ['[::1]:3000/v6'], ['/relative/path']]),
    ['/a/b?page=1#top', '/', '/', '/?q=1', '/v6', '/relative/path'],
  );
});

test('short url keeps the host when another host has the same method and path', () => {
  assert.deepEqual(
    shortUrls([['https://api.x.test/orders', 'POST'], ['https://staging.x.test/orders', 'POST'], ['https://other.x.test/orders', 'GET']]),
    ['api.x.test/orders', 'staging.x.test/orders', '/orders'],
  );
  assert.deepEqual(shortUrls([['http://localhost:3000/a'], ['http://localhost:4000/a']]), ['localhost:3000/a', 'localhost:4000/a']);
});

test('the same host in another case is not a different host', () => {
  assert.deepEqual(shortUrls([['https://API.x.test/a'], ['https://api.x.test/a']]), ['/a', '/a']);
});

test('search shows the full url only when the match needs the host', () => {
  const [row] = rowsFor([['https://api.shop.test/api/orders']]);
  assert.equal(displayUrl(row, ''), '/api/orders');
  assert.equal(displayUrl(row, 'orders'), '/api/orders');
  assert.equal(displayUrl(row, 'api'), '/api/orders');
  assert.equal(displayUrl(row, 'R0'), '/api/orders');
  assert.equal(displayUrl(row, 'SHOP'), 'api.shop.test/api/orders');
  assert.equal(displayUrl(row, 'orders shop'), 'api.shop.test/api/orders');
  assert.equal(displayUrl(row, 'test/api'), 'api.shop.test/api/orders');
});

test('filtering still searches the hidden host', () => {
  const rows = rowsFor([['https://api.shop.test/orders']]);
  assert.equal(filterRows(rows, 'shop').length, 1);
});

test('a request that cannot run does not force others to show their host', () => {
  assert.equal(rowsFor([['https://api.x.test/a'], ['{{nope}}/a']])[0].shortUrl, '/a');
});
