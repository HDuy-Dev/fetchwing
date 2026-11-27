import test from 'node:test';
import assert from 'node:assert/strict';
import { isLargeValue, valueSummary, pastedValue, jsonState, openText, savedText, hasUnsafeNumber, indentAt, findVar, saveCheck } from '../src/lib/env-value.js';

test('isLargeValue: line breaks or a non-empty JSON object/array', () => {
  for (const s of ['a\nb', '{"a":1}', ' [1]']) assert.equal(isLargeValue(s), true, s);
  for (const s of ['', 'abc', '{}', '[]', '{oops', '{{host}}', '42', 'x'.repeat(500)]) assert.equal(isLargeValue(s), false, s);
});

test('valueSummary: lines when more than one, otherwise keys or items', () => {
  assert.deepEqual(valueSummary('{\n "a": 1\n}', false), { kind: 'JSON', size: '3 lines', preview: '{ "a": 1 }' });
  assert.equal(valueSummary('{"a":1}', false).size, '1 key');
  assert.equal(valueSummary('[1,2]', false).size, '2 items');
  assert.equal(valueSummary('a\r\nb', false).kind, 'Text');
  assert.equal(valueSummary('a'.repeat(200) + '\nb', false).preview.length, 80);
  assert.equal(valueSummary('top\nsecret', true).preview, '••••••••');
});

test('pastedValue only takes over for text with inner line breaks', () => {
  assert.equal(pastedValue('', 0, 0, 'token\n'), null);
  assert.equal(pastedValue('', 0, 0, 'token\r\n'), null);
  assert.equal(pastedValue('', 0, 0, 'a\r\nb\r\n'), 'a\nb\n');
  assert.equal(pastedValue('xxYY', 2, 4, '1\n2'), 'xx1\n2');
});

test('jsonState reports only text that looks like JSON, with line and column', () => {
  assert.equal(jsonState('hello'), null);
  assert.deepEqual(jsonState(' {"a":1}'), { valid: true });
  const bad = jsonState('{\n  "a": 1,\n}');
  assert.equal(bad.valid, false);
  assert.match(bad.message, /^Line 3, column 1: /);
  assert.doesNotMatch(bad.message, /position/);
  assert.equal(jsonState('{"a": x}').valid, false);
});

test('openText formats only one-line JSON objects and arrays', () => {
  assert.equal(openText('{"a":1}'), '{\n  "a": 1\n}');
  assert.equal(openText('{ "a":1,\n"b":2 }'), '{ "a":1,\n"b":2 }');
  assert.equal(openText('plain'), 'plain');
  assert.equal(openText('{oops'), '{oops');
});

test('savedText keeps an untouched value and packs edited one-line JSON', () => {
  const big = '{"id":12345678901234567890, "s":"\\u0041"}';
  assert.equal(savedText(big, openText(big)), big);
  assert.equal(savedText('{"a":1}', '{\n  "a": 2\n}'), '{"a":2}');
  assert.equal(savedText('{"a":1}', '{\n  "a": \n}'), '{\n  "a": \n}');
  assert.equal(savedText('{\n"a":1}', '{\n"a":2}'), '{\n"a":2}');
  assert.equal(savedText('abc', 'a\nb'), 'a\nb');
  assert.equal(savedText('', '{\n}'), '{\n}');
});

test('hasUnsafeNumber looks at numbers, also inside JSON strings, not at plain strings', () => {
  assert.equal(hasUnsafeNumber('{"id":12345678901234567890}'), true);
  assert.equal(hasUnsafeNumber('{"p":"{\\"id\\":12345678901234567890}"}'), true);
  assert.equal(hasUnsafeNumber('{"id":"12345678901234567890","x":1.5}'), false);
});

test('indentAt repeats the current line indent', () => {
  assert.equal(indentAt('{\n    "a": 1', 12), '    ');
  assert.equal(indentAt('    x', 2), '  ');
  assert.equal(indentAt('x', 1), '');
});

test('findVar never returns a different variable', () => {
  const vars = [{ key: 'a' }, { key: 'b' }, { key: 'd' }, { key: 'd' }];
  assert.equal(findVar(vars, { key: 'b', index: 1 }), 1);
  assert.equal(findVar(vars, { key: 'b', index: 0 }), 1);
  assert.equal(findVar(vars, { key: 'z', index: 0 }), -1);
  assert.equal(findVar(vars, { key: 'd', index: 0 }), -1);
  assert.equal(findVar(vars, { key: '', index: 0 }), -1);
});

test('saveCheck', () => {
  assert.equal(saveCheck('a', 'a', false), 'ok');
  assert.equal(saveCheck('a', 'b', false), 'changed');
  assert.equal(saveCheck('a', 'b', true), 'ok');
  assert.equal(saveCheck('a', null, true), 'gone');
});

test('findVar finds an unnamed variable only by its unchanged value', () => {
  const vars = [{ key: 'a', value: '1' }, { key: '', value: 'x\ny' }, { key: '', value: 'z' }];
  assert.equal(findVar(vars, { key: '', index: 1, value: 'x\ny' }), 1);
  assert.equal(findVar(vars, { key: '', index: 0, value: 'z' }), 2);
  assert.equal(findVar(vars, { key: '', index: 1, value: 'other' }), -1);
});

test('findVar does not move to a namesake when the name was shared at open', () => {
  const second = { key: 'a', index: 1, value: 'two', unique: false };
  assert.equal(findVar([{ key: 'a', value: 'one' }], second), -1);
  const first = { key: 'a', index: 0, value: 'one', unique: false };
  assert.equal(findVar([{ key: 'a', value: 'two' }], first), -1);
  assert.equal(findVar([{ key: 'a', value: 'two' }, { key: 'a', value: 'one' }], first), 1);
  assert.equal(findVar([{ key: 'x', value: '' }, { key: 'a', value: 'new' }], { key: 'a', index: 0, value: 'one', unique: true }), 1);
});
