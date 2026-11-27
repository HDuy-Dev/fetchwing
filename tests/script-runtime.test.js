import test from 'node:test';
import assert from 'node:assert/strict';
import { runScript, formatArg } from '../src/lib/script-runtime.js';

const response = (over = {}) => ({
  status: 200, statusText: 'OK', timeMs: 12, headers: [['Content-Type', 'application/json']], bodyText: '{"token":"abc"}', ...over,
});
const run = (source, { res = response(), vars = {} } = {}) => runScript(source, { response: res, vars });

test('reads json and sets env', async () => {
  const out = await run("fw.env.set('token', fw.response.json().token)");
  assert.deepEqual(out.changes, [{ op: 'set', key: 'token', value: 'abc' }]);
  assert.equal(out.error, undefined);
});

test('pm alias works', async () => {
  const out = await run("pm.environment.set('id', pm.response.code)", { res: response({ status: 201 }) });
  assert.deepEqual(out.changes, [{ op: 'set', key: 'id', value: '201' }]);
});

test('set stringifies objects as JSON and keeps strings', async () => {
  const out = await run("fw.env.set('o', {a:1}); fw.env.set('s', 'x')");
  assert.deepEqual(out.changes, [{ op: 'set', key: 'o', value: '{"a":1}' }, { op: 'set', key: 's', value: 'x' }]);
});

test('get sees earlier set; unset then has is false', async () => {
  const out = await run("fw.env.set('a','2'); console.log(fw.env.get('a'), fw.env.get('b')); fw.env.unset('b'); console.log(fw.env.has('b'))",
    { vars: { a: '1', b: 'x' } });
  assert.deepEqual(out.logs.map(l => l.text), ['2 x', 'false']);
});

test('toObject and response fields', async () => {
  const out = await run("console.log(fw.response.status, fw.response.responseTime, fw.response.text()); console.log(fw.env.toObject())",
    { vars: { a: '1' } });
  assert.deepEqual(out.logs.map(l => l.text), ['OK 12 {"token":"abc"}', '{\n  "a": "1"\n}']);
});

test('headers.get is case-insensitive', async () => {
  const out = await run("console.log(fw.response.headers.get('content-type'), fw.response.headers.get('x-none'))");
  assert.equal(out.logs[0].text, 'application/json undefined');
});

test('headers.toObject', async () => {
  const out = await run('console.log(fw.response.headers.toObject())');
  assert.equal(out.logs[0].text, '{\n  "Content-Type": "application/json"\n}');
});

test('console levels and formatting', async () => {
  const out = await run("console.log('a', {b:1}); console.warn(undefined); console.error(new TypeError('x'))");
  assert.deepEqual(out.logs, [
    { level: 'log', text: 'a {\n  "b": 1\n}' },
    { level: 'warn', text: 'undefined' },
    { level: 'error', text: 'TypeError: x' },
  ]);
});

test('circular object logs safely', async () => {
  const out = await run("const o = {n:1}; o.self = o; console.info(o)");
  assert.equal(out.logs[0].level, 'info');
  assert.match(out.logs[0].text, /\[Circular\]/);
});

test('json on non-JSON body errors but keeps earlier changes', async () => {
  const out = await run("fw.env.set('a','1'); fw.response.json();", { res: response({ bodyText: '<html>' }) });
  assert.deepEqual(out.changes, [{ op: 'set', key: 'a', value: '1' }]);
  assert.match(out.error, /SyntaxError/);
});

test("throw 'text' is reported", async () => {
  assert.equal((await run("throw 'text'")).error, 'text');
});

test('syntax error in the script is reported', async () => {
  assert.match((await run('let = ;')).error, /SyntaxError/);
});

test('top-level await', async () => {
  const out = await run("await Promise.resolve(); console.log('ok')");
  assert.deepEqual(out.logs, [{ level: 'log', text: 'ok' }]);
});

test('last op per key wins', async () => {
  const out = await run("fw.env.set('a','1'); fw.env.unset('a')");
  assert.deepEqual(out.changes, [{ op: 'unset', key: 'a' }]);
});

test('formatArg basics', () => {
  assert.equal(formatArg('s'), 's');
  assert.equal(formatArg(undefined), 'undefined');
  assert.equal(formatArg(null), 'null');
  assert.equal(formatArg(3), '3');
  assert.equal(formatArg(10n), '10');
});
