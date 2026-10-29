import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveVars, envVars, resolveRequest } from '../src/lib/vars.js';

test('replaces variables', () => {
  assert.deepEqual(resolveVars('{{base}}/u/{{ id }}', { base: 'http://h', id: '7' }), { value: 'http://h/u/7', missing: [] });
});

test('reports missing once and leaves them in place', () => {
  assert.deepEqual(resolveVars('{{a}}-{{a}}-{{b}}', { b: 'x' }), { value: '{{a}}-{{a}}-x', missing: ['a'] });
  assert.deepEqual(resolveVars('', {}), { value: '', missing: [] });
});

test('envVars reads the active environment, later keys win', () => {
  const ws = {
    activeEnvId: 'e1',
    environments: {
      e1: { id: 'e1', deleted: false, vars: [{ key: 'a', value: '1' }, { key: 'a', value: '2' }, { key: '', value: 'x' }] },
      e2: { id: 'e2', deleted: false, vars: [{ key: 'a', value: 'other' }] },
    },
  };
  assert.deepEqual(envVars(ws), { a: '2' });
  assert.deepEqual(envVars({ ...ws, activeEnvId: null }), {});
});

test('resolveRequest skips disabled headers and resolves body', () => {
  const req = {
    method: 'post',
    url: '{{base}}/x',
    headers: [{ key: 'A', value: '{{tok}}', enabled: true }, { key: 'B', value: '1', enabled: false }],
    body: { mode: 'json', raw: '{"t":"{{tok}}"}', fields: [{ key: 'k', value: '{{nope}}', enabled: true }] },
  };
  const r = resolveRequest(req, { base: 'http://h', tok: 'T' });
  assert.equal(r.method, 'POST');
  assert.equal(r.url, 'http://h/x');
  assert.deepEqual(r.headers, [['A', 'T']]);
  assert.equal(r.body.raw, '{"t":"T"}');
  assert.deepEqual(r.body.fields, [{ key: 'k', value: '{{nope}}', enabled: true }]);
  assert.deepEqual(r.missing, ['nope']);
});
