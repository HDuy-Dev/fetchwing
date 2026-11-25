// Works on JSON text rather than parsed values, so editing JSON held in a string
// leaves the rest of the body, and big numbers, exactly as written.
// A path is a list of keys and indexes from the body root, running straight
// through any strings that hold JSON.

// The non-empty object or array held in a string, or null.
export function parseEmbedded(str) {
  if (!/^\s*[[{]/.test(str)) return null;
  try {
    const value = JSON.parse(str);
    return Object.keys(value).length ? value : null;
  } catch {
    return null;
  }
}

const TOKEN = /"(?:[^"\\]|\\.)*"|[[\]{},:]|[^\s"[\]{},:]+/g;

// Re-spaces valid JSON, copying every string and number as written.
export function formatJson(text, indent) {
  const tokens = text.match(TOKEN) ?? [];
  const line = depth => (indent ? `\n${' '.repeat(indent * depth)}` : '');
  let out = '';
  let depth = 0;
  tokens.forEach((token, i) => {
    const emptyPair = (token === '}' && tokens[i - 1] === '{') || (token === ']' && tokens[i - 1] === '[');
    if (token === '{' || token === '[') {
      out += token;
      depth++;
      const next = tokens[i + 1];
      if (next !== '}' && next !== ']') out += line(depth);
    } else if (token === '}' || token === ']') {
      depth--;
      if (!emptyPair) out += line(depth);
      out += token;
    } else if (token === ',') out += token + line(depth);
    else if (token === ':') out += indent ? ': ' : ':';
    else out += token;
  });
  return out;
}

// [start, end) of the value under `segment` in the object or array that is `text`,
// or null. Like JSON.parse, the last of any duplicate keys wins.
function findChild(text, segment) {
  const tokens = [...text.matchAll(TOKEN)];
  const root = tokens[0]?.[0];
  if (root !== '{' && root !== '[') return null;
  let found = null;
  let i = 1;
  let index = 0;
  while (i < tokens.length - 1) {
    let key = index;
    if (root === '{') {
      key = JSON.parse(tokens[i][0]);
      i += 2; // key and colon
    }
    const start = tokens[i].index;
    let depth = 0;
    do {
      const t = tokens[i][0];
      if (t === '{' || t === '[') depth++;
      else if (t === '}' || t === ']') depth--;
      i++;
    } while (depth > 0);
    if (key === segment) found = [start, tokens[i - 1].index + tokens[i - 1][0].length];
    i++; // comma or closing bracket
    index++;
  }
  return found;
}

// Calls `edit` on the string at `path` and returns `text` with only that string
// replaced; layers on the way are re-encoded one by one. null if the path or the
// string isn't there. `edit` may return its input to leave the text untouched.
function editString(text, path, edit) {
  let [start, end] = [0, text.length];
  let rest = path;
  while (rest.length) {
    const child = findChild(text.slice(start, end), rest[0]);
    if (!child) return null;
    [start, end] = [start + child[0], start + child[1]];
    rest = rest.slice(1);
    if (text[start] === '"') break;
  }
  if (text[start] !== '"') return null;
  const decoded = JSON.parse(text.slice(start, end));
  const next = rest.length ? editString(decoded, rest, edit) : edit(decoded);
  if (next === null) return null;
  return next === decoded ? text : text.slice(0, start) + JSON.stringify(next) + text.slice(end);
}

function stringAt(body, path) {
  let found = null;
  editString(body, path, s => (found = s));
  return found;
}

export function editorText(body, path) {
  return formatJson(stringAt(body, path) ?? '', 2);
}

export function replaceEmbedded(body, path, edited) {
  let value;
  try {
    value = JSON.parse(edited);
  } catch (e) {
    return { error: `Invalid JSON: ${e.message}` };
  }
  if (value === null || typeof value !== 'object') return { error: 'Enter a JSON object or array.' };
  const next = editString(body, path, original => (
    edited === formatJson(original, 2) ? original : formatJson(edited, original.trim().includes('\n') ? 2 : 0)));
  return next === null ? { error: 'This field is no longer in the body.' } : { body: next };
}

export function pathLabel(path) {
  return path.reduce((out, s) => {
    if (typeof s === 'number') return `${out}[${s}]`;
    if (!/^[A-Za-z_$][\w$]*$/.test(s)) return `${out}[${JSON.stringify(s)}]`;
    return out ? `${out}.${s}` : s;
  }, '');
}
