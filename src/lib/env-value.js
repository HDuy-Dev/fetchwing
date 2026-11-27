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
  if (!/[\r\n]/.test(pasted.trimEnd())) return null;
  return current.slice(0, start) + pasted.replace(/\r\n?/g, '\n') + current.slice(end);
}

export function jsonState(text) {
  if (!looksLikeJson(text)) return null;
  try {
    JSON.parse(text);
    return { valid: true };
  } catch (e) {
    const at = /position (\d+)/.exec(e.message);
    if (!at) return { valid: false, message: e.message };
    const before = text.slice(0, Number(at[1])).split('\n');
    const reason = e.message.replace(/( in JSON)? at position.*$/s, '');
    return { valid: false, message: `Line ${before.length}, column ${before.at(-1).length + 1}: ${reason}` };
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

function isUnsafe(token) {
  if (/^-?\d+$/.test(token)) return !Number.isSafeInteger(Number(token));
  const digits = token.split(/[eE]/)[0].replace(/[-.]/g, '').replace(/^0+/, '').replace(/0+$/, '');
  return digits.length > 17;
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
// A variable with no name yet is known only by the value it had.
export function findVar(vars, { key, index, value }) {
  const same = v => v?.key === key && (key !== '' || v.value === value);
  if (same(vars[index])) return index;
  const matches = vars.flatMap((v, i) => (same(v) ? [i] : []));
  return matches.length === 1 ? matches[0] : -1;
}

export function saveCheck(base, current, forced) {
  if (current === null) return 'gone';
  return current !== base && !forced ? 'changed' : 'ok';
}
