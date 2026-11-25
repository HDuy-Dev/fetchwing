import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEmbedded, formatJson, editorText, replaceEmbedded, pathLabel } from '../src/lib/json-text.js';

const wrap = inner => JSON.stringify(inner);

test('only non-empty objects and arrays count as embedded JSON', () => {
  assert.deepEqual(parseEmbedded(' {"a":1}'), { a: 1 });
  assert.deepEqual(parseEmbedded('[1]'), [1]);
  for (const s of ['123', '"x"', 'true', 'null', '{}', '[]', '{a:1}', '', 'hello']) assert.equal(parseEmbedded(s), null, s);
});

test('formatJson keeps tokens verbatim', () => {
  const src = '{"b":12345678901234567890,"a":[1.50,"x { } , : \\" \\\\"],"e":{},"f":[]}';
  const pretty = formatJson(src, 2);
  assert.equal(pretty, '{\n  "b": 12345678901234567890,\n  "a": [\n    1.50,\n    "x { } , : \\" \\\\"\n  ],\n  "e": {},\n  "f": []\n}');
  assert.equal(formatJson(pretty, 0), src);
});

test('replaces only the edited string', () => {
  const body = `{\n "keep" : 99999999999999999999,\n "d": ${wrap('{"price":"12"}')},\n "t":"\\u00e9"}`;
  const text = editorText(body, ['d']);
  assert.equal(text, '{\n  "price": "12"\n}');
  const res = replaceEmbedded(body, ['d'], text.replace('"12"', '"15"'));
  assert.equal(res.body, body.replace(wrap('{"price":"12"}'), wrap('{"price":"15"}')));
});

test('no change leaves the body identical', () => {
  const body = '{"d":"{ \\"a\\" : 1 }"}';
  assert.equal(replaceEmbedded(body, ['d'], editorText(body, ['d'])).body, body);
});

test('multi-line original stays indented', () => {
  const body = wrap({ d: '{\n    "a": 1\n}' });
  const res = replaceEmbedded(body, ['d'], '{"a":2}');
  assert.equal(JSON.parse(res.body).d, '{\n  "a": 2\n}');
});

test('rewraps every layer, through arrays', () => {
  const deep = wrap({ n: 1 });
  const mid = `{"deep":${wrap(deep)},"big":10000000000000000001}`;
  const body = `{"list":[0,{"mid":${wrap(mid)}}]}`;
  const res = replaceEmbedded(body, ['list', 1, 'mid', 'deep'], '{"n":2}');
  const newMid = mid.replace(wrap(deep), wrap(wrap({ n: 2 })));
  assert.equal(res.body, body.replace(wrap(mid), wrap(newMid)));
});

test('big integers inside the edited string survive', () => {
  const body = wrap({ d: '{"id":12345678901234567890,"x":1}' });
  const res = replaceEmbedded(body, ['d'], editorText(body, ['d']).replace('"x": 1', '"x": 2'));
  assert.equal(JSON.parse(res.body).d, '{"id":12345678901234567890,"x":2}');
});

test('duplicate keys: the last one wins', () => {
  const body = `{"d":${wrap('{"a":1}')},"d":${wrap('{"a":2}')}}`;
  assert.equal(editorText(body, ['d']), '{\n  "a": 2\n}');
  assert.equal(replaceEmbedded(body, ['d'], '{"a":3}').body, `{"d":${wrap('{"a":1}')},"d":${wrap('{"a":3}')}}`);
});

test('rejects bad edits', () => {
  const body = wrap({ d: '{"a":1}' });
  for (const bad of ['{"a":', '12', '"x"', 'null', '']) {
    const res = replaceEmbedded(body, ['d'], bad);
    assert.ok(res.error, bad);
    assert.equal(res.body, undefined);
  }
});

test('path labels', () => {
  assert.equal(pathLabel(['product_details']), 'product_details');
  assert.equal(pathLabel(['a', 0, 'phone-4', 'b']), 'a[0]["phone-4"].b');
});
