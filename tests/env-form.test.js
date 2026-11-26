import test from 'node:test';
import assert from 'node:assert/strict';
import { copyName, savableVars, hintName, envPatch } from '../src/lib/env-form.js';

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
