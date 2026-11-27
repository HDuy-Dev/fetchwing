import test from 'node:test';
import assert from 'node:assert/strict';
import { consoleEntries, NO_ENV_WARNING } from '../src/lib/script-console.js';

test('logs, then error, then env changes', () => {
  const entries = consoleEntries({
    logs: [{ level: 'log', text: 'hi' }],
    changes: [{ op: 'set', key: 'token', value: 'abc' }, { op: 'unset', key: 'old' }],
    error: 'TypeError: x',
  }, { secretKeys: new Set(), envSaved: true });
  assert.deepEqual(entries, [
    { level: 'log', text: 'hi' },
    { level: 'error', text: 'TypeError: x' },
    { level: 'info', text: 'env set token = abc' },
    { level: 'info', text: 'env unset old' },
  ]);
});

test('secret values are masked', () => {
  const entries = consoleEntries({ logs: [], changes: [{ op: 'set', key: 'pw', value: 'hunter2' }] },
    { secretKeys: new Set(['pw']), envSaved: true });
  assert.deepEqual(entries, [{ level: 'info', text: 'env set pw = ••••' }]);
});

test('no active environment warns instead of listing changes', () => {
  const entries = consoleEntries({ logs: [], changes: [{ op: 'set', key: 'a', value: '1' }] },
    { secretKeys: new Set(), envSaved: false });
  assert.deepEqual(entries, [{ level: 'warn', text: NO_ENV_WARNING }]);
  assert.equal(NO_ENV_WARNING, 'No active environment — env changes were not saved');
});

test('empty result gives no entries', () => {
  assert.deepEqual(consoleEntries({ logs: [], changes: [] }, { secretKeys: new Set(), envSaved: false }), []);
});
