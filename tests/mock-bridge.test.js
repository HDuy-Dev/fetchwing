import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/content/mock-bridge.js', import.meta.url), 'utf8');

function loadBridge() {
  let resolveGet;
  const posted = [];
  const listeners = [];
  const window = {
    postMessage: data => posted.push(data),
    addEventListener: (type, fn) => listeners.push(fn),
  };
  const chrome = {
    storage: {
      local: { get: () => new Promise(r => { resolveGet = r; }) },
      onChanged: { addListener: () => {} },
    },
  };
  vm.runInNewContext(source, { window, chrome });
  const sendReady = () => listeners.forEach(fn => fn({ source: window, data: { source: 'fetchwing-main', type: 'ready' } }));
  return { posted, sendReady, resolveStorage: value => resolveGet(value) };
}

const tick = () => new Promise(r => setImmediate(r));

test('does not answer "ready" with an empty list before storage has loaded', async () => {
  const b = loadBridge();
  b.sendReady();
  assert.deepEqual(b.posted, [], 'nothing may be posted before the real list is known');
  b.resolveStorage({ activeMocks: [{ key: 'GET http://a/x' }] });
  await tick();
  assert.deepEqual(b.posted.map(p => p.mocks.length), [1]);
  b.sendReady();
  assert.deepEqual(b.posted.map(p => p.mocks.length), [1, 1]);
});
