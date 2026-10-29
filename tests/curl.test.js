import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCurl } from '../src/lib/curl.js';

const BASH = `curl 'https://api.example.com/v1/users?page=2&size=10' \\
  -H 'accept: application/json' \\
  -H 'authorization: Bearer abc' \\
  -b 'sid=1; theme=dark' \\
  --data-raw '{"name":"A"}'`;

const CMD = `curl ^"https://api.example.com/v1/users?page=2^&size=10^" ^
  -H ^"accept: application/json^" ^
  -H ^"authorization: Bearer abc^" ^
  -b ^"sid=1; theme=dark^" ^
  --data-raw ^"^{^\\^"name^\\^":^\\^"A^\\^"^}^"`;

const headerMap = r => Object.fromEntries(r.headers.map(h => [h.key, h.value]));

test('parses Chrome bash copy', () => {
  const r = parseCurl(BASH);
  assert.equal(r.method, 'POST');
  assert.equal(r.url, 'https://api.example.com/v1/users?page=2&size=10');
  assert.deepEqual(headerMap(r), { accept: 'application/json', authorization: 'Bearer abc' });
  assert.ok(r.headers.every(h => h.enabled === true));
  assert.equal(r.cookie, 'sid=1; theme=dark');
  assert.deepEqual(r.body, { mode: 'json', raw: '{"name":"A"}', fields: [] });
  assert.deepEqual(r.warnings, []);
});

test('parses cmd form', () => {
  assert.deepEqual(parseCurl(CMD), parseCurl(BASH));
});

test('defaults to GET without body', () => {
  const r = parseCurl("curl 'https://x.dev/a' --compressed -s -L");
  assert.equal(r.method, 'GET');
  assert.deepEqual(r.body, { mode: 'none', raw: '', fields: [] });
  assert.deepEqual(r.warnings, []);
});

test('-X overrides method', () => {
  assert.equal(parseCurl("curl -X DELETE https://x.dev/a/1").method, 'DELETE');
  assert.equal(parseCurl("curl --request patch 'https://x.dev/a' -d 'a=1'").method, 'PATCH');
});

test('-u becomes basic auth', () => {
  const r = parseCurl("curl -u user:pa:ss https://x.dev");
  assert.equal(headerMap(r).Authorization, `Basic ${Buffer.from('user:pa:ss').toString('base64')}`);
});

test('-G moves data to query', () => {
  const r = parseCurl("curl -G https://x.dev/search -d 'q=a b' -d 'n=1'");
  assert.equal(r.method, 'GET');
  assert.equal(r.url, 'https://x.dev/search?q=a b&n=1');
  assert.equal(r.body.mode, 'none');
});

test('form fields from -F', () => {
  const r = parseCurl("curl https://x.dev/up -F 'name=Ann' -F 'age=3'");
  assert.equal(r.method, 'POST');
  assert.deepEqual(r.body, {
    mode: 'formdata', raw: '',
    fields: [{ key: 'name', value: 'Ann', enabled: true }, { key: 'age', value: '3', enabled: true }],
  });
});

test('urlencoded body', () => {
  const r = parseCurl("curl https://x.dev/login -H 'Content-Type: application/x-www-form-urlencoded' -d 'u=a&p=b%20c'");
  assert.deepEqual(r.body, {
    mode: 'urlencoded', raw: 'u=a&p=b%20c',
    fields: [{ key: 'u', value: 'a', enabled: true }, { key: 'p', value: 'b c', enabled: true }],
  });
  const plain = parseCurl("curl https://x.dev/login -d 'u=a&p=b'");
  assert.equal(plain.body.mode, 'urlencoded');
  const text = parseCurl("curl https://x.dev/t --data-binary 'hello world'");
  assert.deepEqual(text.body, { mode: 'text', raw: 'hello world', fields: [] });
});

test("$'…' strings decode escapes", () => {
  const r = parseCurl("curl https://x.dev -H $'x-a: it\\'s' --data-raw $'line1\\nline2'");
  assert.equal(headerMap(r)['x-a'], "it's");
  assert.equal(r.body.raw, 'line1\nline2');
});

test('double quotes and backslash escapes in bash', () => {
  const r = parseCurl('curl "https://x.dev/a" -H "x-q: say \\"hi\\"" -A agent/1 -e https://ref.dev');
  assert.deepEqual(headerMap(r), { 'x-q': 'say "hi"', 'User-Agent': 'agent/1', Referer: 'https://ref.dev' });
});

test('unknown flags produce warnings', () => {
  const r = parseCurl("curl https://x.dev --http2 --max-time 5");
  assert.deepEqual(r.warnings, ['Ignored option --http2', 'Ignored option --max-time']);
});

test('errors', () => {
  assert.deepEqual(parseCurl('wget https://x.dev'), { error: 'Not a cURL command' });
  assert.deepEqual(parseCurl('curl -H "a: b"'), { error: 'No URL found' });
  assert.deepEqual(parseCurl("curl 'https://x.dev"), { error: 'Unterminated quote' });
});

import { splitCurlCommands } from '../src/lib/curl.js';

test('splits several commands', () => {
  const text = `# exported from the Network tab
curl 'https://x.dev/a' \\
  -H 'accept: */*'

curl 'https://x.dev/b' -X POST --data-raw '{}'
not a command
curl ^"https://x.dev/c^" ^
  -H ^"x: 1^"`;
  const parts = splitCurlCommands(text);
  assert.equal(parts.length, 4);
  assert.equal(parseCurl(parts[0]).url, 'https://x.dev/a');
  assert.deepEqual(parseCurl(parts[0]).headers.map(h => h.key), ['accept']);
  assert.equal(parseCurl(parts[1]).method, 'POST');
  assert.deepEqual(parseCurl(parts[2]), { error: 'Not a cURL command' });
  assert.equal(parseCurl(parts[3]).url, 'https://x.dev/c');
});

test('keeps continuation lines with their command', () => {
  assert.deepEqual(splitCurlCommands("curl 'https://x.dev' \\\n  -d 'a=1'"), ["curl 'https://x.dev' \\\n  -d 'a=1'"]);
  assert.deepEqual(splitCurlCommands('   \n# only comments\n'), []);
});
