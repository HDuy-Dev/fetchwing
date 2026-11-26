import test from 'node:test';
import assert from 'node:assert/strict';
import { jsonLines, initialCollapsed } from '../src/lib/json-lines.js';

const brief = lines => lines.map(l => `${'  '.repeat(l.depth)}${l.key !== null ? `${l.key}: ` : ''}${l.text}${l.comma ? ',' : ''}`);

test('lines for nested object', () => {
  const lines = jsonLines({ a: 1, b: [true, 'x'], c: null });
  assert.deepEqual(brief(lines), [
    '{',
    '  a: 1,',
    '  b: [,',
    '    true,',
    '    "x"',
    '  ],',
    '  c: null',
    '}',
  ].map(s => s.replace('[,', '[')));
});

test('open line knows its end, size and kind', () => {
  const lines = jsonLines({ list: [1, 2, 3] });
  const open = lines[1];
  assert.equal(open.kind, 'open');
  assert.equal(open.size, 3);
  assert.equal(open.bracket, '[');
  assert.equal(lines[open.end].kind, 'close');
  assert.equal(lines[open.end].text, ']');
  assert.equal(lines[0].end, lines.length - 1);
  assert.equal(lines[2].valueType, 'number');
});

test('empty containers are single value lines', () => {
  const lines = jsonLines({ a: [], b: {} });
  assert.deepEqual(brief(lines), ['{', '  a: [],', '  b: {}', '}']);
  assert.equal(lines[1].kind, 'value');
  assert.equal(lines[1].block, null);
});

test('scalars at the root', () => {
  assert.deepEqual(brief(jsonLines('hi')), ['"hi"']);
  assert.deepEqual(brief(jsonLines(42)), ['42']);
});

test('folds deep when large', () => {
  const big = { items: Array.from({ length: 1000 }, (_, i) => ({ id: i, tags: ['a', 'b'] })), total: 1000 };
  const lines = jsonLines(big);
  assert.ok(lines.length > 5000);
  const collapsed = initialCollapsed(lines, { maxVisible: 2000 });
  // Count what stays visible.
  let visible = 0;
  for (let i = 0; i < lines.length; i++) {
    visible++;
    if (lines[i].kind === 'open' && collapsed.has(lines[i].block)) i = lines[i].end;
  }
  assert.ok(visible <= 2000, `visible ${visible}`);
  assert.ok(visible > 3, 'something stays open');
  assert.equal(collapsed.has(lines[0].block), false, 'root never collapses');
  assert.deepEqual(initialCollapsed(jsonLines({ a: 1 }), { maxVisible: 2000 }), new Set());
});

test('expands JSON held in strings and records the path', () => {
  const lines = jsonLines({ list: [{ d: JSON.stringify({ e: '[1]' }) }], n: '123', x: '{}' });
  const embedded = lines.filter(l => l.embedded);
  assert.deepEqual(embedded.map(l => l.embedded), [['list', 0, 'd'], ['list', 0, 'd', 'e']]);
  assert.equal(embedded[0].kind, 'open');
  assert.equal(lines[embedded[0].end].text, '}');
  assert.equal(lines.find(l => l.key === 'n').text, '"123"');
  assert.equal(lines.find(l => l.key === 'x').text, '"{}"');
});

test('a root string is not expanded', () => {
  assert.equal(jsonLines('{"a":1}').length, 1);
});

test('every line carries its path; close lines share their block path', () => {
  const lines = jsonLines({ a: { b: [1] } });
  assert.deepEqual(lines.find(l => l.text === '1').path, ['a', 'b', 0]);
  assert.deepEqual(lines[0].path, []);
  const closeB = lines.filter(l => l.kind === 'close')[0];
  assert.deepEqual(closeB.path, ['a', 'b']);
});
