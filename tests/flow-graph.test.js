import test from 'node:test';
import assert from 'node:assert/strict';
import { newRequest } from '../src/lib/model.js';
import { usedVars, upstream, topoOrder, analyzeFlow, edgeVars, blockFingerprint } from '../src/lib/flow-graph.js';

const req = (id, fields) => ({ id, type: 'request', parentId: null, order: 0, name: id, updatedAt: 0, deleted: false, ...newRequest(fields) });
const block = (id, requestId, outputs = []) => ({ id, kind: 'request', requestId, x: 0, y: 0, outputs });
const ws = () => ({
  items: {
    login: req('login', { method: 'POST', url: '{{base}}/login' }),
    user: req('user', { url: '{{base}}/me', headers: [{ key: 'Authorization', value: 'Bearer {{token}}', enabled: true }] }),
    a: req('a'),
    b: req('b'),
    c: req('c', { url: '/x/{{id}}' }),
  },
});

test('usedVars reads url, enabled headers and body, sorted and unique', () => {
  const r = newRequest({
    url: '{{b}}/{{a}}',
    headers: [{ key: 'X', value: '{{c}}', enabled: true }, { key: 'Y', value: '{{off}}', enabled: false }],
    body: { mode: 'urlencoded', raw: '{{ignored}}', fields: [{ key: 'k', value: '{{a}}', enabled: true }, { key: 'z', value: '{{off2}}', enabled: false }] },
  });
  assert.deepEqual(usedVars(r), ['a', 'b', 'c']);
  assert.deepEqual(usedVars(newRequest({ body: { mode: 'json', raw: '{"t":"{{ t }}"}', fields: [] } })), ['t']);
});

test('upstream and topoOrder', () => {
  const flow = { blocks: [block('3', 'c'), block('2', 'b'), block('1', 'a')], edges: [{ from: '1', to: '2' }, { from: '2', to: '3' }] };
  assert.deepEqual([...upstream(flow, '3')].sort(), ['1', '2']);
  assert.deepEqual(topoOrder(flow), ['1', '2', '3']);
});

test('analyzeFlow resolves variables from upstream outputs and env', () => {
  const flow = { blocks: [block('L', 'login', [{ name: 'token', path: 'body.token' }]), block('U', 'user')], edges: [{ from: 'L', to: 'U' }] };
  const info = analyzeFlow(ws(), flow, { base: 'http://h' });
  assert.deepEqual(info.get('U').uses, [{ name: 'base', from: 'env' }, { name: 'token', from: 'L' }]);
  assert.deepEqual(info.get('U').missing, []);
  assert.deepEqual(analyzeFlow(ws(), flow, {}).get('U').missing, ['base']);
});

test('parallel providers conflict, nearer provider wins', () => {
  const out = [{ name: 'id', path: 'body.id' }];
  const parallel = { blocks: [block('A', 'a', out), block('B', 'b', out), block('C', 'c')], edges: [{ from: 'A', to: 'C' }, { from: 'B', to: 'C' }] };
  const p = analyzeFlow(ws(), parallel, {}).get('C');
  assert.deepEqual(p.conflicts, ['id']);
  assert.deepEqual(p.missing, []);
  assert.deepEqual(p.uses, [{ name: 'id', from: null }]);
  const chain = { blocks: parallel.blocks, edges: [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }] };
  const c = analyzeFlow(ws(), chain, {}).get('C');
  assert.deepEqual(c.uses, [{ name: 'id', from: 'B' }]);
  assert.deepEqual(c.conflicts, []);
});

test('deleted request marks the block deleted', () => {
  const w = ws();
  w.items.a.deleted = true;
  const info = analyzeFlow(w, { blocks: [block('A', 'a'), block('X', 'gone')], edges: [] }, {});
  assert.equal(info.get('A').deleted, true);
  assert.equal(info.get('A').request, null);
  assert.equal(info.get('X').deleted, true);
});

test('edgeVars lists outputs the next request uses', () => {
  const flow = { blocks: [block('L', 'login', [{ name: 'token', path: 'body.token' }, { name: 'extra', path: 'body.x' }]), block('U', 'user')], edges: [{ from: 'L', to: 'U' }] };
  assert.deepEqual(edgeVars(ws(), flow, flow.edges[0]), ['token']);
});

test('blockFingerprint ignores name and position, tracks url, mock and env', () => {
  const base = ws().items.user;
  const fp = blockFingerprint(base, { base: 'h', token: 't' });
  assert.equal(blockFingerprint({ ...base, name: 'renamed', order: 5, updatedAt: 9 }, { base: 'h', token: 't' }), fp);
  assert.notEqual(blockFingerprint({ ...base, url: '/other' }, { base: 'h' }), fp);
  assert.notEqual(blockFingerprint({ ...base, mock: { ...base.mock, enabled: true } }, { base: 'h', token: 't' }), fp);
  assert.notEqual(blockFingerprint(base, { base: 'h2', token: 't' }), fp);
  assert.equal(blockFingerprint(base, { base: 'h', token: 't', unused: 'z' }), fp);
});
