// What the variable table and the value dialog decide, kept apart from their DOM.

import { formatJson, parseEmbedded } from './json-text.js';

const looksLikeJson = text => /^\s*[[{]/.test(text);

function parses(text) {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

// Too much for a one-line input: it has line breaks, or it is a JSON object or array.
export const isLargeValue = value => /[\r\n]/.test(value) || parseEmbedded(value) !== null;

const count = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;

export function valueSummary(value, secret) {
  const json = parseEmbedded(value);
  const lines = value.split(/\r?\n/).length;
  let size = count(lines, 'line');
  if (lines === 1 && json) size = Array.isArray(json) ? count(json.length, 'item') : count(Object.keys(json).length, 'key');
  return {
    kind: looksLikeJson(value) && parses(value) ? 'JSON' : 'Text',
    size,
    preview: secret ? '••••••••' : value.replace(/\s+/g, ' ').trim().slice(0, 80),
  };
}

// The value after a paste that a one-line input would flatten, or null to let the browser paste.
export function pastedValue(current, start, end, pasted) {
  if (!/[\r\n]/.test(pasted.trim())) return null;
  return current.slice(0, start) + pasted.replace(/\r\n?/g, '\n') + current.slice(end);
}

export const isUndoKey = e => Boolean(e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z';

// How the engine words an unexpected character: it quotes the text and gives no position.
const unexpected = /is not valid JSON$/;

function errorOf(text) {
  try {
    JSON.parse(text);
    return '';
  } catch (e) {
    return e.message;
  }
}

// A prefix that stops short of that character fails some other way, so the
// character ends the shortest prefix that fails like this.
function unexpectedAt(text) {
  let low = 1;
  let high = text.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (unexpected.test(errorOf(text.slice(0, middle)))) high = middle;
    else low = middle + 1;
  }
  return low - 1;
}

// Where and why parsing failed. The engine's own message may quote the text, so
// only wording known not to is passed on.
function parseFault(text, message) {
  const at = /position (\d+)/.exec(message);
  if (at) return { position: Number(at[1]), reason: message.replace(/( in JSON)? at position.*$/s, '') };
  if (unexpected.test(message)) return { position: unexpectedAt(text), reason: 'Unexpected character' };
  if (message.startsWith('Unexpected end of JSON')) return { position: text.length, reason: 'Unexpected end of JSON input' };
  return null;
}

export function jsonState(text) {
  if (!looksLikeJson(text)) return null;
  try {
    JSON.parse(text);
    return { valid: true };
  } catch (e) {
    const fault = parseFault(text, e.message);
    if (!fault) return { valid: false, message: 'Not valid JSON' };
    const before = text.slice(0, fault.position).split('\n');
    return { valid: false, message: `Line ${before.length}, column ${before.at(-1).length + 1}: ${fault.reason}` };
  }
}

// What the editor starts with: one-line JSON is laid out, anything else is as stored.
export function openText(value) {
  return !value.includes('\n') && parseEmbedded(value) && parses(value) ? formatJson(value, 2) : value;
}

// What to store: an untouched value is left alone, and JSON that was one line goes back to one.
export function savedText(original, edited) {
  if (edited === openText(original)) return original;
  if (!original.includes('\n') && isLargeValue(original) && parses(edited)) return formatJson(edited, 0);
  return edited;
}

const STRING_OR_NUMBER = /"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

// A number's value, spelled one way: 1.10, 1.1 and 11e-1 come out the same.
function decimal(number) {
  const [, sign, whole, fraction = '', exponent = 0] = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(number);
  const digits = (whole + fraction).replace(/^0+/, '');
  const kept = digits.replace(/0+$/, '');
  return kept ? `${sign}${kept}e${Number(exponent) - fraction.length + digits.length - kept.length}` : '0';
}

// Whether the number read from `token` is written back as another one.
function isUnsafe(token) {
  const read = Number(token);
  return !Number.isFinite(read) || decimal(String(read)) !== decimal(token);
}

// Whether reading `text` as values would change a number, in it or in a JSON string it holds.
export function hasUnsafeNumber(text) {
  return (text.match(STRING_OR_NUMBER) ?? []).some(token => {
    if (token[0] !== '"') return isUnsafe(token);
    let held;
    try {
      held = JSON.parse(token);
    } catch {
      return false;
    }
    return parseEmbedded(held) !== null && hasUnsafeNumber(held);
  });
}

export function indentAt(text, caret) {
  const line = text.slice(0, caret).split('\n').at(-1);
  return /^[ \t]*/.exec(line)[0];
}

// Where the edited variable is now; -1 rather than a guess that could be another one.
// A variable with no name, or one that shared its name (`unique: false`), is known
// only by the value it had.
export function findVar(vars, { key, index, value, unique = true }) {
  const same = v => v?.key === key && ((key !== '' && unique) || v.value === value);
  if (same(vars[index])) return index;
  const matches = vars.flatMap((v, i) => (same(v) ? [i] : []));
  return matches.length === 1 ? matches[0] : -1;
}

// The row showing `v`: its own place among the table's variables, or, once the
// table has been reloaded from what is saved, wherever it is found; -1 for neither.
export function rowOf(vars, v, target) {
  const at = vars.indexOf(v);
  return at >= 0 ? at : findVar(vars, target);
}

export function saveCheck(base, current, forced) {
  if (current === null) return 'gone';
  return current !== base && !forced ? 'changed' : 'ok';
}
