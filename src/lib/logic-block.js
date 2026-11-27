// Logic blocks: a flow block that runs a script instead of sending a request.
// Pure helpers for scanning, checking results and fingerprints.

export const MAX_OUTPUT_BYTES = 1_000_000;
export const NOT_OBJECT_ERROR = 'Script must return an object like { name: value }';

const CALL = /\b(?:fw|pm)\s*\.\s*vars\s*\.\s*(get|has)\s*\(\s*(?:'([^'\\\n]*)'|"([^"\\\n]*)"|`([^`\\$]*)`)\s*\)/g;

// The variable names a script reads by a literal name. `get` names are required, `has`-only ones optional.
export function scanVars(script) {
  const required = new Set();
  const has = new Set();
  for (const m of String(script ?? '').matchAll(CALL)) {
    const name = m[2] ?? m[3] ?? m[4];
    if (!name) continue;
    (m[1] === 'get' ? required : has).add(name);
  }
  const optional = [...has].filter(n => !required.has(n));
  return { required: [...required].sort(), optional: optional.sort() };
}

const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

// What a script's return value gives the declared outputs.
export function checkLogicValue(value, outputNames) {
  const names = outputNames || [];
  if (value === undefined && !names.length) return { outputs: {}, warnings: [] };
  if (!isPlainObject(value)) return { outputs: {}, warnings: [], error: NOT_OBJECT_ERROR };
  const declared = new Set(names);
  const warnings = Object.keys(value).filter(k => !declared.has(k))
    .map(k => `Returned \`${k}\` is not a declared output, so it was ignored`);
  const outputs = {};
  for (const name of names) {
    if (!Object.prototype.hasOwnProperty.call(value, name)) continue;
    let text;
    try { text = JSON.stringify(value[name]); } catch { text = undefined; }
    if (text === undefined) return { outputs: {}, warnings, error: `Output \`${name}\` can't be saved as JSON` };
    if (new TextEncoder().encode(text).length > MAX_OUTPUT_BYTES) return { outputs: {}, warnings, error: `Output \`${name}\` is too large (max 1 MB)` };
    outputs[name] = value[name];
  }
  return { outputs, warnings };
}

// What decides a logic block's result: its script, its outputs and the env values it reads by name.
export function logicFingerprint(block, envVars) {
  const { required, optional } = scanVars(block.script);
  const env = {};
  for (const n of [...required, ...optional].sort()) {
    env[n] = Object.prototype.hasOwnProperty.call(envVars || {}, n) ? envVars[n] : null;
  }
  return JSON.stringify({ script: block.script ?? '', outputs: (block.outputs || []).map(o => o.name), env });
}

// Keys of the last `return { … }` object literal. A small scanner, not a parser.
export function detectOutputs(script) {
  const src = String(script ?? '');
  let start = -1;
  for (const m of src.matchAll(/\breturn\s*\{/g)) start = m.index + m[0].length;
  if (start < 0) return [];
  const keys = [];
  let depth = 1;
  let expectKey = true;
  let i = start;
  const readString = q => {
    let j = i + 1;
    while (j < src.length && src[j] !== q) j += src[j] === '\\' ? 2 : 1;
    const text = src.slice(i + 1, j);
    i = j + 1;
    return text;
  };
  const nextNonSpace = () => { while (i < src.length && /\s/.test(src[i])) i++; return src[i]; };
  while (i < src.length && depth > 0) {
    const c = src[i];
    if (depth === 1 && expectKey) {
      const ch = nextNonSpace();
      let key = null;
      if (ch === '"' || ch === "'") key = readString(ch);
      else {
        const m = /^[A-Za-z_$][\w$]*/.exec(src.slice(i));
        if (m) { key = m[0]; i += key.length; }
      }
      expectKey = false;
      if (key !== null) {
        const after = nextNonSpace();
        if (after === ':' || after === ',' || after === '}') keys.push(key);
      }
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { readString(c); continue; }
    if (c === '{' || c === '[' || c === '(') depth++;
    else if (c === '}' || c === ']' || c === ')') depth--;
    else if (c === ',' && depth === 1) expectKey = true;
    i++;
  }
  return [...new Set(keys)];
}

export function newLogicBlock({ id, x, y }) {
  return { id, kind: 'logic', name: 'Logic', script: '', x, y, outputs: [] };
}
