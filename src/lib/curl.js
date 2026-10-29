// Parses a cURL command, as produced by DevTools "Copy as cURL" (bash or
// Windows cmd flavour), into an editable request.

class ParseError extends Error {}

const ANSI_ESCAPES = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', e: '\x1b', f: '\f', v: '\v', '\\': '\\', "'": "'", '"': '"', '?': '?' };

// POSIX shell words: '…' literal, "…" with \ escapes, $'…' ANSI-C, \ escapes.
function tokenizeBash(text) {
  const words = [];
  let word = null;
  let i = 0;
  const push = ch => { word = (word ?? '') + ch; };
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\' && (text[i + 1] === '\n' || (text[i + 1] === '\r' && text[i + 2] === '\n'))) {
      i += text[i + 1] === '\r' ? 3 : 2;
      continue;
    }
    if (/\s/.test(ch)) {
      if (word !== null) words.push(word);
      word = null;
      i++;
    } else if (ch === "'") {
      const end = text.indexOf("'", i + 1);
      if (end === -1) throw new ParseError('Unterminated quote');
      push(text.slice(i + 1, end));
      i = end + 1;
    } else if (ch === '$' && text[i + 1] === "'") {
      i += 2;
      let out = '';
      for (;;) {
        if (i >= text.length) throw new ParseError('Unterminated quote');
        const c = text[i];
        if (c === "'") { i++; break; }
        if (c === '\\') {
          const n = text[i + 1];
          if (n === 'x' && /^[0-9a-f]{1,2}/i.test(text.slice(i + 2))) {
            const hex = text.slice(i + 2).match(/^[0-9a-f]{1,2}/i)[0];
            out += String.fromCharCode(parseInt(hex, 16));
            i += 2 + hex.length;
          } else if (n === 'u' && /^[0-9a-f]{4}/i.test(text.slice(i + 2))) {
            out += String.fromCharCode(parseInt(text.slice(i + 2, i + 6), 16));
            i += 6;
          } else {
            out += ANSI_ESCAPES[n] ?? '\\' + n;
            i += 2;
          }
        } else {
          out += c;
          i++;
        }
      }
      push(out);
    } else if (ch === '"') {
      i++;
      let out = '';
      for (;;) {
        if (i >= text.length) throw new ParseError('Unterminated quote');
        const c = text[i];
        if (c === '"') { i++; break; }
        if (c === '\\' && '"\\$`\n'.includes(text[i + 1])) {
          if (text[i + 1] !== '\n') out += text[i + 1];
          i += 2;
        } else {
          out += c;
          i++;
        }
      }
      push(out);
    } else if (ch === '\\') {
      push(text[i + 1] ?? '');
      i += 2;
    } else {
      push(ch);
      i++;
    }
  }
  if (word !== null) words.push(word);
  return words;
}

// Windows cmd: first undo caret escapes (and ^-newline continuations), then
// split like the C runtime does: "…" groups, \" is a literal quote.
function tokenizeCmd(text) {
  let s = '';
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '^') {
      if (text[i + 1] === '\r' && text[i + 2] === '\n') { i += 2; continue; }
      if (text[i + 1] === '\n') { i++; continue; }
      if (i + 1 < text.length) s += text[++i];
      continue;
    }
    s += text[i];
  }
  const words = [];
  let word = null;
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') {
      let n = 0;
      while (s[i + n] === '\\') n++;
      if (s[i + n] === '"') {
        word = (word ?? '') + '\\'.repeat(Math.floor(n / 2));
        if (n % 2) { word += '"'; i += n; continue; }
        i += n - 1;
        continue;
      }
      word = (word ?? '') + '\\'.repeat(n);
      i += n - 1;
    } else if (c === '"') {
      quoted = !quoted;
      word = word ?? '';
    } else if (/\s/.test(c) && !quoted) {
      if (word !== null) words.push(word);
      word = null;
    } else {
      word = (word ?? '') + c;
    }
  }
  if (quoted) throw new ParseError('Unterminated quote');
  if (word !== null) words.push(word);
  return words;
}

const isCmd = text => text.includes('^"') || /\^\s*\r?\n/.test(text);

const VALUE_FLAGS = {
  '-X': 'method', '--request': 'method',
  '-H': 'header', '--header': 'header',
  '-b': 'cookie', '--cookie': 'cookie',
  '-d': 'data', '--data': 'data', '--data-raw': 'data', '--data-binary': 'data', '--data-ascii': 'data',
  '--data-urlencode': 'urlencode',
  '-F': 'form', '--form': 'form',
  '-u': 'user', '--user': 'user',
  '-A': 'agent', '--user-agent': 'agent',
  '-e': 'referer', '--referer': 'referer',
  '--url': 'url',
};
const SWITCHES = { '-G': 'get', '--get': 'get', '-I': 'head', '--head': 'head' };
const IGNORED = new Set(['--compressed', '-s', '--silent', '-S', '--show-error', '-L', '--location', '-k', '--insecure', '-i', '--include', '-v', '--verbose']);
// Unknown options that take a value: skip the value so it is not taken for the URL.
const UNKNOWN_WITH_VALUE = new Set(['-m', '--max-time', '--connect-timeout', '-o', '--output', '-w', '--write-out', '--retry', '-x', '--proxy', '--cacert', '--cert', '--key', '--resolve', '--limit-rate', '-c', '--cookie-jar']);

function toBase64(s) {
  return btoa(unescape(encodeURIComponent(s)));
}

function decodeForm(s) {
  try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return s; }
}

function formFields(raw) {
  return raw.split('&').filter(Boolean).map(pair => {
    const at = pair.indexOf('=');
    const key = at === -1 ? pair : pair.slice(0, at);
    const value = at === -1 ? '' : pair.slice(at + 1);
    return { key: decodeForm(key), value: decodeForm(value), enabled: true };
  });
}

function looksJson(raw) {
  const t = raw.trim();
  if (!/^[[{]/.test(t)) return false;
  try { JSON.parse(t); return true; } catch { return false; }
}

const looksUrlencoded = raw => /^[^=&\s]+=[^&\s]*(&[^=&\s]+=[^&\s]*)*$/.test(raw);

export function parseCurl(text) {
  let words;
  try {
    words = (isCmd(text) ? tokenizeCmd : tokenizeBash)(String(text).trim());
  } catch (err) {
    if (err instanceof ParseError) return { error: err.message };
    throw err;
  }
  if (words[0] !== 'curl' && words[0] !== 'curl.exe') return { error: 'Not a cURL command' };

  let method = null;
  let get = false;
  const headers = [];
  const cookies = [];
  const data = [];
  const form = [];
  const positional = [];
  const warnings = [];
  let url = null;

  for (let i = 1; i < words.length; i++) {
    let flag = words[i];
    let value;
    if (flag.startsWith('--') && flag.includes('=')) {
      value = flag.slice(flag.indexOf('=') + 1);
      flag = flag.slice(0, flag.indexOf('='));
    } else if (/^-[A-Za-z]./.test(flag) && VALUE_FLAGS[flag.slice(0, 2)]) {
      value = flag.slice(2);
      flag = flag.slice(0, 2);
    }
    const kind = VALUE_FLAGS[flag];
    if (kind) {
      if (value === undefined) value = words[++i] ?? '';
      switch (kind) {
        case 'method': method = value.toUpperCase(); break;
        case 'header': {
          const at = value.indexOf(':');
          if (at > 0) {
            const key = value.slice(0, at).trim();
            const v = value.slice(at + 1).trim();
            if (key.toLowerCase() === 'cookie') cookies.push(v);
            else headers.push({ key, value: v, enabled: true });
          }
          break;
        }
        case 'cookie': cookies.push(value); break;
        case 'data': data.push(value); break;
        case 'urlencode': {
          const at = value.indexOf('=');
          data.push(at === -1 ? encodeURIComponent(value) : `${value.slice(0, at)}=${encodeURIComponent(value.slice(at + 1))}`);
          break;
        }
        case 'form': {
          const at = value.indexOf('=');
          form.push({ key: at === -1 ? value : value.slice(0, at), value: at === -1 ? '' : value.slice(at + 1), enabled: true });
          break;
        }
        case 'user': headers.push({ key: 'Authorization', value: `Basic ${toBase64(value)}`, enabled: true }); break;
        case 'agent': headers.push({ key: 'User-Agent', value, enabled: true }); break;
        case 'referer': headers.push({ key: 'Referer', value, enabled: true }); break;
        case 'url': url = value; break;
      }
    } else if (SWITCHES[flag]) {
      if (SWITCHES[flag] === 'get') get = true;
      else method = method ?? 'HEAD';
    } else if (IGNORED.has(flag)) {
      // Transport options that do not change the request.
    } else if (flag.startsWith('-') && flag.length > 1) {
      warnings.push(`Ignored option ${flag}`);
      if (UNKNOWN_WITH_VALUE.has(flag) && value === undefined) i++;
    } else {
      positional.push(flag);
    }
  }

  url = url ?? positional.find(p => /^[a-z][a-z0-9+.-]*:\/\//i.test(p)) ?? positional[0] ?? null;
  if (!url) return { error: 'No URL found' };

  let body = { mode: 'none', raw: '', fields: [] };
  const raw = data.join('&');
  if (get && data.length) {
    url += (url.includes('?') ? '&' : '?') + raw;
  } else if (form.length) {
    body = { mode: 'formdata', raw: '', fields: form };
  } else if (data.length) {
    const type = headers.find(h => h.key.toLowerCase() === 'content-type')?.value.toLowerCase() ?? '';
    if (type.includes('json') || (!type && looksJson(raw))) body = { mode: 'json', raw, fields: [] };
    else if (type.includes('x-www-form-urlencoded') || (!type && looksUrlencoded(raw))) body = { mode: 'urlencoded', raw, fields: formFields(raw) };
    else body = { mode: 'text', raw, fields: [] };
  }

  const hasBody = body.mode !== 'none';
  return {
    method: method ?? (get ? 'GET' : hasBody ? 'POST' : 'GET'),
    url,
    headers,
    body,
    cookie: cookies.length ? cookies.join('; ') : null,
    warnings,
  };
}
