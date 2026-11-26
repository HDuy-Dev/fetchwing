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

// ---------- editing the whole body ----------
// The body is read into a tree that keeps every token as written. A node is
// { token } for a scalar, { open: '{', entries } or { open: '[', items }, and
// carries `packed: { token, text }` when it was read out of a string.

const ANY = null; // any array index, in a pattern

function readTree(text, expand) {
  const tokens = text.match(TOKEN);
  let i = 0;
  const read = depth => {
    const token = tokens[i++];
    if (token === '{') {
      const entries = [];
      while (tokens[i] !== '}') {
        const keyToken = tokens[i];
        i += 2; // key and colon
        entries.push({ keyToken, key: JSON.parse(keyToken), node: read(depth + 1) });
        if (tokens[i] === ',') i++;
      }
      i++;
      return { open: '{', entries };
    }
    if (token === '[') {
      const items = [];
      while (tokens[i] !== ']') {
        items.push(read(depth + 1));
        if (tokens[i] === ',') i++;
      }
      i++;
      return { open: '[', items };
    }
    if (expand && depth > 0 && token[0] === '"') {
      const held = JSON.parse(token);
      if (parseEmbedded(held)) return { ...readTree(held, true), packed: { token, text: held } };
    }
    return { token };
  };
  return read(0);
}

// segment -> node under a node, built once. Like JSON.parse, the last duplicate key wins.
const childCache = new WeakMap();
const NONE = new Map();
function childrenOf(node) {
  if (!node.open) return NONE;
  let map = childCache.get(node);
  if (!map) {
    map = new Map(node.open === '[' ? node.items.map((item, i) => [i, item]) : node.entries.map(e => [e.key, e.node]));
    childCache.set(node, map);
  }
  return map;
}

// Compact text of a tree. `pack(node, path, text)` may turn a container into something else.
function write(node, pack, path = []) {
  if (!node.open) return node.token;
  const text = node.open === '['
    ? `[${node.items.map((item, i) => write(item, pack, [...path, i])).join(',')}]`
    : `{${node.entries.map(e => `${e.keyToken}:${write(e.node, pack, [...path, e.key])}`).join(',')}}`;
  return pack ? pack(node, path, text) : text;
}

const patternOf = path => path.map(s => (typeof s === 'number' ? ANY : s));
const idOf = path => JSON.stringify(path);

const nodeAt = (tree, path) => path.reduce((node, segment) => node && childrenOf(node).get(segment), tree);

// What the original held at each pattern: which strings were packed JSON, and
// whether real objects sat at the same place.
function packedPlaces(tree) {
  const places = new Map();
  const visit = (node, path) => {
    if (!node.open) return;
    if (path.length) {
      const pattern = patternOf(path);
      const id = idOf(pattern);
      if (!places.has(id)) places.set(id, { pattern, packed: [], real: false, exact: new Map(), same: new Map() });
      const place = places.get(id);
      if (node.packed) {
        place.packed.push(node.packed);
        place.exact.set(idOf(path), node.packed);
        place.same.set(write(node), node.packed.token);
      } else place.real = true;
    }
    for (const [segment, child] of childrenOf(node)) visit(child, [...path, segment]);
  };
  visit(tree, []);
  return places;
}

// How many places along `pattern` cannot take its next step, one count per step.
// A string typed or pasted where a packed one was is a value of its own: nothing
// below it counts.
function deadEnds(tree, pattern, places) {
  let nodes = [tree];
  return pattern.map((segment, step) => {
    const wasPacked = step > 0 && places.get(idOf(pattern.slice(0, step)))?.packed.length > 0;
    let dead = 0;
    nodes = nodes.flatMap(node => {
      if (node.open !== (segment === ANY ? '[' : '{')) {
        if (node.open || !wasPacked) dead++;
        return [];
      }
      if (segment === ANY) return node.items;
      const child = childrenOf(node).get(segment);
      if (!child) dead++;
      return child ? [child] : [];
    });
    return dead;
  });
}

// Every pattern at which a tree has an object or array.
function containerPatterns(tree) {
  const found = new Set();
  const visit = (node, pattern) => {
    if (!node.open) return;
    found.add(idOf(pattern));
    for (const [segment, child] of childrenOf(node)) visit(child, [...pattern, typeof segment === 'number' ? ANY : segment]);
  };
  visit(tree, []);
  return found;
}

const patternLabel = pattern => pathLabel(pattern.map(s => (s === ANY ? 0 : s)))
  .replace(/\[0\]/g, '[*]');

export function unpackBody(body) {
  return formatJson(write(readTree(body, true)), 2);
}

// Turns text edited from unpackBody(body) back into a body, packing strings again.
// `warnings` names the fields that may no longer be saved as they were.
export function packBody(body, edited) {
  try {
    JSON.parse(edited);
  } catch (e) {
    return { error: `Invalid JSON: ${e.message}` };
  }
  if (edited === unpackBody(body)) return { body, warnings: [] };
  const before = readTree(body, true);
  const after = readTree(edited, false);
  const places = packedPlaces(before);
  const warnings = [];
  const known = containerPatterns(before);
  const hasNewPlace = [...containerPatterns(after)].some(id => !known.has(id));
  const written = new Map(); // outer arrays of mixed places, serialised once
  const writeOnce = node => written.get(node) ?? written.set(node, write(node)).get(node);

  for (const { pattern, packed, real } of places.values()) {
    if (!packed.length) continue;
    const was = deadEnds(before, pattern, places);
    // More places miss a step than before, or one misses it while an object turned
    // up somewhere new (a rename that another edit would hide from the count).
    let unsure = deadEnds(after, pattern, places).some((count, i) => (
      count > was[i] || (hasNewPlace && count > 0 && pattern[i] !== ANY)));
    // Strings and real objects side by side: only the position says which is which.
    if (real && pattern.includes(ANY)) {
      const array = pattern.slice(0, pattern.indexOf(ANY));
      const now = nodeAt(after, array);
      unsure ||= !now || writeOnce(nodeAt(before, array)) !== writeOnce(now);
    }
    if (unsure) warnings.push(patternLabel(pattern));
  }

  const out = write(after, (node, path, text) => {
    const place = path.length ? places.get(idOf(patternOf(path))) : undefined;
    if (!place?.packed.length) return text;
    const original = place.exact.get(idOf(path));
    if (place.real && !original) return text;
    // `text` has inner strings packed again; compare what the user sees instead.
    const unchanged = place.same.get(write(node));
    if (unchanged) return unchanged;
    const style = (original ?? place.packed[0]).text.trim().includes('\n') ? 2 : 0;
    return JSON.stringify(formatJson(text, style));
  });
  return { body: formatJson(out, body.trim().includes('\n') ? 2 : 0), warnings };
}
