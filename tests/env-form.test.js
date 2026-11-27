import test from 'node:test';
import assert from 'node:assert/strict';
import { copyName, savableVars, hintName, envPatch, sameEnv, filterEnvs, pickerRows } from '../src/lib/env-form.js';

const v = (key, value = '') => ({ key, value, secret: false });

test('copyName marks the copy', () => {
  assert.equal(copyName('Local'), 'Local copy');
});

test('savableVars drops only rows with neither a name nor a value', () => {
  assert.deepEqual(savableVars([v(''), v('a'), v('', 'x')]), [v('a'), v('', 'x')]);
});

test('hintName shows the first named variable, or baseUrl', () => {
  assert.equal(hintName([]), 'baseUrl');
  assert.equal(hintName([v('', 'x'), v('token'), v('host')]), 'token');
});

test('envPatch leaves out a blank name so the variables still save', () => {
  assert.deepEqual(envPatch('  ', [v('a'), v('')]), { vars: [v('a')] });
  assert.deepEqual(envPatch('Staging', []), { vars: [], name: 'Staging' });
});

test('sameEnv ignores blank rows, so our own save does not redraw the table', () => {
  const env = { name: 'Local', vars: [v('a', '1')] };
  assert.equal(sameEnv('Local', [v('a', '1'), v('')], env), true);
  assert.equal(sameEnv('  ', [v('a', '1')], env), true);
  assert.equal(sameEnv('Local ', [v('a', '1')], env), true);
  assert.equal(sameEnv('Local', [v('a', '2')], env), false);
  assert.equal(sameEnv('Other', [v('a', '1')], env), false);
  assert.equal(sameEnv('Local', [{ ...v('a', '1'), secret: true }], env), false);
});

test('filterEnvs matches names, ignoring case and outer spaces', () => {
  const envs = [{ name: 'SO1 DEVICE_K2' }, { name: 'Local' }];
  assert.deepEqual(filterEnvs(envs, '  device '), [envs[0]]);
  assert.deepEqual(filterEnvs(envs, ''), envs);
  assert.deepEqual(filterEnvs(envs, 'zzz'), []);
});

test('pickerRows keeps No Environment and Create around the matches', () => {
  const envs = [{ id: 'a', name: 'Local' }, { id: 'b', name: 'Staging' }];
  assert.deepEqual(pickerRows(envs, 'stag', 'b'), [
    { kind: 'none', active: false },
    { kind: 'env', id: 'b', name: 'Staging', active: true },
    { kind: 'create' },
  ]);
  assert.deepEqual(pickerRows(envs, 'zzz', null), [{ kind: 'none', active: true }, { kind: 'create' }]);
});
