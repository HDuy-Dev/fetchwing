// Flattens a parsed JSON value into display lines with fold information,
// so the panel can render line numbers and collapse { } / [ ] blocks.
// A string holding a JSON object/array is shown as that value; its open line
// carries `embedded`, the path to the string.
// Line: { depth, key, kind: 'open'|'close'|'value', text, comma, block,
//         end, size, bracket, valueType, embedded }

import { parseEmbedded } from './json-text.js';

export function jsonLines(value) {
  const lines = [];
  let nextBlock = 0;

  function walk(raw, depth, key, comma, path) {
    const held = depth > 0 && typeof raw === 'string' ? parseEmbedded(raw) : null;
    const v = held ?? raw;
    const isObj = v !== null && typeof v === 'object';
    const entries = isObj ? (Array.isArray(v) ? v.map((x, i) => [i, x]) : Object.entries(v)) : null;
    if (!isObj || entries.length === 0) {
      lines.push({
        depth, key, kind: 'value', comma, embedded: null, block: null, end: null, size: null, bracket: null,
        text: isObj ? (Array.isArray(v) ? '[]' : '{}') : JSON.stringify(v),
        valueType: v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v,
      });
      return;
    }
    const [open, close] = Array.isArray(v) ? ['[', ']'] : ['{', '}'];
    const line = { depth, key, kind: 'open', text: open, comma: false, block: nextBlock++, end: null, size: entries.length, bracket: open, valueType: Array.isArray(v) ? 'array' : 'object', embedded: held ? path : null };
    lines.push(line);
    entries.forEach(([k, child], i) => walk(child, depth + 1, Array.isArray(v) ? null : k, i < entries.length - 1, [...path, k]));
    line.end = lines.length;
    lines.push({ depth, key: null, kind: 'close', text: close, comma, block: line.block, end: null, size: null, bracket: close, valueType: line.valueType, embedded: null });
  }

  walk(value, 0, null, false, []);
  return lines;
}

function visibleCount(lines, collapsed) {
  let visible = 0;
  for (let i = 0; i < lines.length; i++) {
    visible++;
    if (lines[i].kind === 'open' && collapsed.has(lines[i].block)) i = lines[i].end;
  }
  return visible;
}

// Blocks to start collapsed so a huge response doesn't render thousands of
// rows: collapse whole depth levels, deepest first, until it fits.
export function initialCollapsed(lines, { maxVisible = 2000 } = {}) {
  const collapsed = new Set();
  if (lines.length <= maxVisible) return collapsed;
  const opens = lines.filter(l => l.kind === 'open' && l.depth >= 1);
  const maxDepth = opens.reduce((m, l) => Math.max(m, l.depth), 0);
  for (let depth = maxDepth; depth >= 1; depth--) {
    for (const l of opens) if (l.depth === depth) collapsed.add(l.block);
    if (visibleCount(lines, collapsed) <= maxVisible) break;
  }
  return collapsed;
}
