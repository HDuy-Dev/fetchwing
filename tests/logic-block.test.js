import test from 'node:test';
import assert from 'node:assert/strict';
import { scanVars, checkLogicValue, logicFingerprint, detectOutputs, newLogicBlock, MAX_OUTPUT_BYTES } from '../src/lib/logic-block.js';

test('scanVars finds literal get/has names; has-only names are optional', () => {
  const s = "const a = fw.vars.get('price'); if (pm.vars.has(\"qty\")) x = fw.vars.get(`qty`); fw.vars.has('coupon'); fw.vars.get(key);";
  assert.deepEqual(scanVars(s), { required: ['price', 'qty'], optional: ['coupon'] });
  assert.deepEqual(scanVars('fw.vars.get(`a${b}`)'), { required: [], optional: [] });
  assert.deepEqual(scanVars('fw.vars . get ( "a" )'), { required: ['a'], optional: [] });
  assert.deepEqual(scanVars(''), { required: [], optional: [] });
});

test('checkLogicValue keeps declared keys, warns on others', () => {
  const r = checkLogicValue({ total: 6, extra: 1 }, ['total', 'ids']);
  assert.deepEqual(r.outputs, { total: 6 });
  assert.deepEqual(r.warnings, ['Returned `extra` is not a declared output, so it was ignored']);
  assert.equal(r.error, undefined);
});

test('checkLogicValue rejects non-objects only when outputs are declared', () => {
  for (const v of [null, [1], 'x', 3]) assert.equal(checkLogicValue(v, ['a']).error, 'Script must return an object like { name: value }');
  assert.deepEqual(checkLogicValue(undefined, []), { outputs: {}, warnings: [] });
  assert.equal(checkLogicValue(undefined, ['a']).error, 'Script must return an object like { name: value }');
});

test('checkLogicValue rejects unserialisable and >1 MB outputs', () => {
  const loop = {}; loop.self = loop;
  assert.equal(checkLogicValue({ a: loop }, ['a']).error, 'Output `a` can\'t be saved as JSON');
  assert.equal(checkLogicValue({ a: () => 1 }, ['a']).error, 'Output `a` can\'t be saved as JSON');
  assert.equal(checkLogicValue({ a: 'x'.repeat(MAX_OUTPUT_BYTES + 1) }, ['a']).error, 'Output `a` is too large (max 1 MB)');
  assert.equal(MAX_OUTPUT_BYTES, 1_000_000);
});

test('logicFingerprint changes with script, output names and scanned env values only', () => {
  const b = { script: "fw.vars.get('k')", outputs: [{ name: 'o' }] };
  const fp = logicFingerprint(b, { k: '1', other: 'x' });
  assert.equal(fp, logicFingerprint(b, { k: '1', other: 'y' }));
  assert.notEqual(fp, logicFingerprint(b, { k: '2' }));
  assert.notEqual(fp, logicFingerprint({ ...b, script: b.script + ';' }, { k: '1' }));
  assert.notEqual(fp, logicFingerprint({ ...b, outputs: [] }, { k: '1' }));
});

test('detectOutputs reads the last returned object literal', () => {
  assert.deepEqual(detectOutputs('if (x) return { a: 1 };\nreturn { total, ids: [1, { z: 2 }], "q": 3, s: "}" };'), ['total', 'ids', 'q', 's']);
  assert.deepEqual(detectOutputs('return result;'), []);
  assert.deepEqual(detectOutputs(''), []);
});

test('newLogicBlock has the default shape', () => {
  assert.deepEqual(newLogicBlock({ id: 'b1', x: 16, y: 32 }), { id: 'b1', kind: 'logic', name: 'Logic', script: '', x: 16, y: 32, outputs: [] });
});
