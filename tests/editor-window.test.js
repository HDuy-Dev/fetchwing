import test from 'node:test';
import assert from 'node:assert/strict';
import { editorUrl, editorParams, openEditorWindow } from '../src/lib/editor-window.js';

const BASE = 'chrome-extension://abc/';

function fakeChrome({ contexts = [], failUpdate = false } = {}) {
  const calls = [];
  return {
    calls,
    runtime: {
      getURL: path => BASE + path,
      getContexts: async filter => { calls.push(['getContexts', filter]); return contexts; },
    },
    windows: {
      create: async options => { calls.push(['create', options]); },
      update: async (id, options) => {
        calls.push(['update', id, options]);
        if (failUpdate) throw new Error('No window with id');
      },
    },
    storage: { session: { set: async value => { calls.push(['set', value]); } } },
  };
}
const named = (chrome, name) => chrome.calls.filter(c => c[0] === name);

test('editor url carries the request and the web tab', () => {
  assert.equal(editorUrl('a b&c', 7), 'src/panel/panel.html?window=1&request=a+b%26c&tabId=7');
  assert.equal(editorUrl('a', null), 'src/panel/panel.html?window=1&request=a');
});

test('editor params are read back from the url', () => {
  assert.deepEqual(editorParams('?window=1&request=a+b%26c&tabId=7'), { isEditor: true, requestId: 'a b&c', tabId: 7 });
  assert.deepEqual(editorParams(''), { isEditor: false, requestId: null, tabId: null });
  assert.deepEqual(editorParams('?tabId=9'), { isEditor: false, requestId: null, tabId: 9 });
});

test('opens a 1000x700 popup window when there is no editor window', async () => {
  const chrome = fakeChrome();
  await openEditorWindow(chrome, { requestId: 'a', tabId: 7 });
  assert.deepEqual(named(chrome, 'create'), [['create', { url: `${BASE}src/panel/panel.html?window=1&request=a&tabId=7`, type: 'popup', width: 1000, height: 700 }]]);
  assert.deepEqual(named(chrome, 'getContexts'), [['getContexts', { contextTypes: ['TAB'] }]]);
  assert.equal(named(chrome, 'set').length, 0);
});

test('reuses the editor window: says which request, then focuses it', async () => {
  const chrome = fakeChrome({ contexts: [{ documentUrl: `${BASE}src/panel/panel.html?window=1&request=old`, windowId: 42 }] });
  await openEditorWindow(chrome, { requestId: 'b', tabId: 7 });
  const [[, { reveal }]] = named(chrome, 'set');
  assert.equal(reveal.requestId, 'b');
  assert.equal(reveal.tabId, 7);
  assert.equal(typeof reveal.at, 'number');
  assert.deepEqual(chrome.calls.map(c => c[0]), ['getContexts', 'set', 'update']);
  assert.deepEqual(named(chrome, 'update'), [['update', 42, { focused: true }]]);
});

test('other extension tabs are not taken for the editor window', async () => {
  const chrome = fakeChrome({ contexts: [
    { documentUrl: `${BASE}src/panel/panel.html`, windowId: 1 },
    { documentUrl: `${BASE}src/grant/grant.html?window=1`, windowId: 2 },
  ] });
  await openEditorWindow(chrome, { requestId: 'a' });
  assert.equal(named(chrome, 'create').length, 1);
  assert.equal(named(chrome, 'update').length, 0);
});

test('opens a new window when the old one cannot be focused', async () => {
  const chrome = fakeChrome({ failUpdate: true, contexts: [{ documentUrl: `${BASE}src/panel/panel.html?window=1&request=old`, windowId: 42 }] });
  await openEditorWindow(chrome, { requestId: 'a' });
  assert.equal(named(chrome, 'create').length, 1);
});
