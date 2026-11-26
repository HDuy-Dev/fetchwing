// Output paths: read a value out of a response, e.g. body.data.token, headers.x-id, status.

const NAME = /[^.\[\]"\s]+/y;

export function parsePath(text) {
  const s = String(text ?? '').trim();
  const fail = error => ({ ok: false, error });
  const root = /^(status|body|headers)/.exec(s);
  if (!root) return fail('Path must start with status, headers.<name> or body');
  const steps = [{ key: root[1] }];
  let i = root[1].length;
  if (root[1] === 'headers') {
    if (s[i] !== '.') return fail('Use headers.<name>');
    NAME.lastIndex = i + 1;
    const m = NAME.exec(s);
    if (!m) return fail('Missing header name');
    steps.push({ key: m[0] });
    i = NAME.lastIndex;
  }
  while (i < s.length) {
    const c = s[i];
    if (c === '.') {
      NAME.lastIndex = i + 1;
      const m = NAME.exec(s);
      if (!m) return fail(`Expected a name after "." at ${i + 1}`);
      steps.push({ key: m[0] });
      i = NAME.lastIndex;
    } else if (c === '[') {
      const rest = s.slice(i);
      let m;
      if ((m = /^\[\*\]/.exec(rest))) steps.push({ all: true });
      else if ((m = /^\[(\d+)\]/.exec(rest))) steps.push({ index: Number(m[1]) });
      else if ((m = /^\[("(?:[^"\\]|\\.)*")\]/.exec(rest))) {
        try { steps.push({ key: JSON.parse(m[1]) }); } catch { return fail(`Bad key at ${i + 1}`); }
      } else return fail(`Bad bracket at ${i + 1}`);
      i += m[0].length;
    } else return fail(`Unexpected "${c}" at ${i + 1}`);
  }
  return { ok: true, steps };
}

const MISS = Symbol('miss');

function walk(value, steps) {
  if (!steps.length) return value;
  const [step, ...rest] = steps;
  if (step.all) {
    if (!Array.isArray(value)) return MISS;
    return value.map(v => walk(v, rest)).filter(v => v !== MISS);
  }
  if ('index' in step) {
    if (!Array.isArray(value) || step.index >= value.length) return MISS;
    return walk(value[step.index], rest);
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return MISS;
  if (!Object.prototype.hasOwnProperty.call(value, step.key)) return MISS;
  return walk(value[step.key], rest);
}

export function readOutput(response, path) {
  const parsed = parsePath(path);
  if (!parsed.ok) return { found: false };
  const [root, ...steps] = parsed.steps;
  if (root.key === 'status') {
    return steps.length || response.status == null ? { found: false } : { found: true, value: response.status };
  }
  if (root.key === 'headers') {
    const want = steps[0].key.toLowerCase();
    const hit = (response.headers || []).find(([name]) => String(name).toLowerCase() === want);
    return hit && steps.length === 1 ? { found: true, value: hit[1] } : { found: false };
  }
  const miss = () => (response.bodyTruncated ? { error: 'truncated' } : { found: false });
  let json;
  try {
    json = JSON.parse(response.bodyText ?? '');
  } catch {
    return steps.length || response.bodyTruncated ? miss() : { found: true, value: response.bodyText ?? '' };
  }
  const value = walk(json, steps);
  return value === MISS ? miss() : { found: true, value };
}

export function toText(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

export function pathFor(keys) {
  let out = 'body';
  for (const k of keys) {
    if (typeof k === 'number') out += `[${k}]`;
    else if (/[.\[\]"\s]/.test(k) || k === '') out += `[${JSON.stringify(k)}]`;
    else out += `.${k}`;
  }
  return out;
}
