import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEmbedded, formatJson, editorText, replaceEmbedded, pathLabel, unpackBody, packBody } from '../src/lib/json-text.js';

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

const J = JSON.stringify;
const edit = (body, from, to) => {
  const text = unpackBody(body);
  assert.ok(text.includes(from), from);
  return packBody(body, text.replace(from, to));
};

test('unpackBody expands every layer and keeps number digits', () => {
  const body = J({ d: `{"e":${J('[1]')},"id":12345678901234567890}`, s: '123' });
  assert.equal(unpackBody(body), '{\n  "d": {\n    "e": [\n      1\n    ],\n    "id": 12345678901234567890\n  },\n  "s": "123"\n}');
});

test('packBody with no change returns the body as written', () => {
  const body = `{ "d" :${J('{ "a":1 }')} }`;
  assert.deepEqual(packBody(body, unpackBody(body)), { body, warnings: [] });
});

test('packBody packs changed strings and reuses untouched ones', () => {
  const kept = '"{ \\"k\\" : \\"\\u00e9\\" }"';
  const deep = `{"in":${J('{"n":1}')},"big":10000000000000000001}`;
  const body = `{"keep":${kept},"d":${J(deep)},"x":1}`;
  const res = edit(body, '"n": 1', '"n": 2');
  assert.deepEqual(res.warnings, []);
  assert.equal(res.body, body.replace(J(deep), J(deep.replace(J('{"n":1}'), J('{"n":2}')))));
});

test('packBody keeps one-line and multi-line styles', () => {
  const body = J({ d: '{\n  "a": 1\n}' }, null, 2);
  assert.equal(edit(body, '"a": 1', '"a": 2').body, J({ d: '{\n  "a": 2\n}' }, null, 2));
});

test('new, inserted and reordered array items are packed', () => {
  const body = J({ list: [{ d: '{"n":1}' }, { d: '{"n":2}' }] });
  const res = packBody(body, J({ list: [{ d: { n: 9 } }, { d: { n: 2 } }, { d: { n: 1 } }] }));
  assert.deepEqual(res, { body: J({ list: [{ d: '{"n":9}' }, { d: '{"n":2}' }, { d: '{"n":1}' }] }), warnings: [] });
});

test('removing an array item or emptying the array does not warn', () => {
  const body = J({ list: [{ d: '{"n":1}' }, { d: '{"n":2}' }] });
  assert.deepEqual(packBody(body, J({ list: [{ d: { n: 2 } }] })).warnings, []);
  assert.deepEqual(packBody(body, J({ list: [] })).warnings, []);
});

test('renamed, moved or deleted packed fields warn', () => {
  const body = J({ a: { d: '{"n":1}' }, list: [{ m: { d: '[1]' } }] });
  const text = unpackBody(body);
  assert.deepEqual(packBody(body, text.replace('"d"', '"e"')).warnings, ['a.d']);
  assert.deepEqual(packBody(body, text.replace('"a"', '"z"')).warnings, ['a.d']);
  assert.deepEqual(packBody(body, text.replace('"list"', '"rows"')).warnings, ['list[*].m.d']);
  assert.deepEqual(packBody(body, text.replace('"m"', '"q"')).warnings, ['list[*].m.d']);
});

test('a packed field typed as another value is kept, already-string values stay', () => {
  const body = J({ d: '{"n":1}', e: '{"n":2}' });
  const res = packBody(body, J({ d: null, e: '{"n":3}' }));
  assert.deepEqual(res, { body: J({ d: null, e: '{"n":3}' }), warnings: [] });
});

test('mixed arrays pack by position and warn only when the array changed', () => {
  const list = [{ d: '{"n":1}' }, { d: { n: 2 } }];
  const swapped = packBody(J({ list }), J({ list: [{ d: { n: 2 } }, { d: { n: 1 } }] }));
  assert.deepEqual(swapped.warnings, ['list[*].d']);
  const outside = packBody(J({ list, x: 1 }), J({ list: [{ d: { n: 1 } }, { d: { n: 2 } }], x: 2 }));
  assert.deepEqual(outside, { body: J({ list, x: 2 }), warnings: [] });
});

test('packBody handles a root array, __proto__ and duplicate keys', () => {
  assert.equal(edit(J(['{"n":1}']), '"n": 1', '"n": 2').body, J(['{"n":2}']));
  const proto = `{"__proto__":${J('{"n":1}')}}`;
  assert.equal(edit(proto, '"n": 1', '"n": 2').body, `{"__proto__":${J('{"n":2}')}}`);
  const dup = `{"d":1,"d":${J('{"n":1}')}}`;
  assert.deepEqual(edit(dup, '"n": 1', '"n": 2'), { body: `{"d":1,"d":${J('{"n":2}')}}`, warnings: [] });
});

test('packBody rejects invalid JSON', () => {
  const res = packBody(J({ d: '[1]' }), '{"d":');
  assert.match(res.error, /^Invalid JSON/);
  assert.equal(res.body, undefined);
});
