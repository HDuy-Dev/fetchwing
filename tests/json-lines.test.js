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
