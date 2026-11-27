import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createScriptRunner } from '../src/panel/script-runner.js';
import { runScript, runLogic } from '../src/lib/script-runtime.js';
import { buildScriptSandbox } from '../scripts/sync-mock-main.mjs';

const response = { status: 200, statusText: 'OK', timeMs: 1, headers: [], bodyText: '{}' };

// A frame that answers like the sandbox does, optionally never.
function fakeFrames({ silentRuns = 0, staleFirst = false } = {}) {
  const frames = [];
  let silent = silentRuns;
  const createFrame = onMessage => {
    const frame = {
      destroyed: false,
      posts: [],
      post(msg) {
        frame.posts.push(msg);
        if (silent > 0) { silent--; return; }
        const job = msg.type === 'logic' ? runLogic(msg.script, { vars: msg.vars, env: msg.env }) : runScript(msg.script, { response: msg.response, vars: msg.vars });
        job.then(result => {
          if (staleFirst) onMessage({ source: 'fetchwing-sandbox', type: 'result', runId: msg.runId - 1, logs: [{ level: 'log', text: 'stale' }], changes: [] });
          onMessage({ source: 'fetchwing-sandbox', type: 'result', runId: msg.runId, ...result });
        });
      },
      destroy() { frame.destroyed = true; },
    };
    frames.push(frame);
    queueMicrotask(() => onMessage({ source: 'fetchwing-sandbox', type: 'ready' }));
    return frame;
  };
  return { frames, createFrame };
}

test('waits for ready then resolves result', async () => {
  const { frames, createFrame } = fakeFrames();
  const runner = createScriptRunner({ createFrame });
  const out = await runner.run({ script: "console.log(fw.env.get('a'))", response, vars: { a: 'x' } });
  assert.deepEqual(out, { logs: [{ level: 'log', text: 'x' }], changes: [] });
  assert.equal(frames.length, 1);
  assert.equal(frames[0].posts[0].source, 'fetchwing-panel');
  assert.equal(frames[0].posts[0].type, 'run');
});

test('times out, destroys frame, next run uses a new frame', async () => {
  const { frames, createFrame } = fakeFrames({ silentRuns: 1 });
  const runner = createScriptRunner({ createFrame, timeoutMs: 20 });
  const first = await runner.run({ script: 'while(true){}', response, vars: {} });
  assert.deepEqual(first, { logs: [], changes: [], error: 'Script timed out after 5 s' });
  assert.equal(frames[0].destroyed, true);
  const second = await runner.run({ script: "console.log('ok')", response, vars: {} });
  assert.deepEqual(second.logs, [{ level: 'log', text: 'ok' }]);
  assert.equal(frames.length, 2);
});

test('ignores stale runId', async () => {
  const { createFrame } = fakeFrames({ staleFirst: true });
  const runner = createScriptRunner({ createFrame });
  const out = await runner.run({ script: "console.log('fresh')", response, vars: {} });
  assert.deepEqual(out.logs, [{ level: 'log', text: 'fresh' }]);
});

test('script-sandbox is in sync', () => {
  const root = new URL('..', import.meta.url);
  const runtime = readFileSync(new URL('src/lib/script-runtime.js', root), 'utf8');
  const sandbox = readFileSync(new URL('src/sandbox/script-sandbox.js', root), 'utf8');
  assert.equal(sandbox, buildScriptSandbox(runtime), 'run `npm run sync`');
});

test('each run gets a fresh frame and the old one is destroyed', async () => {
  const { frames, createFrame } = fakeFrames();
  const runner = createScriptRunner({ createFrame });
  await runner.run({ script: '', response, vars: {} });
  await runner.run({ script: '', response, vars: {} });
  assert.equal(frames.length, 2);
  assert.deepEqual(frames.map(f => f.destroyed), [true, true]);
});

test('logic job posts type logic with vars and env and returns the value', async () => {
  const { frames, createFrame } = fakeFrames();
  const runner = createScriptRunner({ createFrame });
  const out = await runner.run({ mode: 'logic', script: "return { v: fw.vars.get('a') + fw.env.get('e') }", vars: { a: 1 }, env: { e: 'x' } });
  assert.deepEqual(out, { logs: [], value: { v: '1x' } });
  assert.equal(frames[0].posts[0].type, 'logic');
  assert.deepEqual(frames[0].posts[0].vars, { a: 1 });
  assert.deepEqual(frames[0].posts[0].env, { e: 'x' });
});

test('a logic timeout is marked timedOut', async () => {
  const { createFrame } = fakeFrames({ silentRuns: 1 });
  const runner = createScriptRunner({ createFrame, timeoutMs: 20 });
  assert.deepEqual(await runner.run({ mode: 'logic', script: '', vars: {}, env: {} }), { logs: [], error: 'Script timed out after 5 s', timedOut: true });
});

test('cancel resolves running and queued jobs as cancelled and destroys the frame', async () => {
  const { frames, createFrame } = fakeFrames({ silentRuns: 1 });
  const runner = createScriptRunner({ createFrame });
  const a = runner.run({ mode: 'logic', script: '', vars: {}, env: {} });
  const b = runner.run({ mode: 'logic', script: '', vars: {}, env: {} });
  await new Promise(r => setTimeout(r, 5));
  runner.cancel();
  const stopped = { logs: [], cancelled: true, error: 'Stopped' };
  assert.deepEqual(await a, stopped);
  assert.deepEqual(await b, stopped);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].destroyed, true);
});

test('a job after cancel runs', async () => {
  const { createFrame } = fakeFrames();
  const runner = createScriptRunner({ createFrame });
  runner.cancel();
  assert.deepEqual(await runner.run({ mode: 'logic', script: 'return { a: 1 }', vars: {}, env: {} }), { logs: [], value: { a: 1 } });
});

// Runs the generated sandbox source against a fake window. `post` stands in for parent.postMessage.
function loadSandbox(post = () => {}) {
  const runtime = readFileSync(new URL('../src/lib/script-runtime.js', import.meta.url), 'utf8');
  const listeners = [];
  const posted = [];
  const parent = { postMessage: msg => { post(msg); posted.push(msg); } };
  const win = { parent, addEventListener: (type, fn) => listeners.push(fn) };
  new Function('window', buildScriptSandbox(runtime))(win);
  const send = data => Promise.all(listeners.map(fn => fn({ source: parent, data })));
  return { posted, send };
}

test('the generated sandbox answers a logic message', async () => {
  const { posted, send } = loadSandbox();
  await send({ source: 'fetchwing-panel', type: 'logic', runId: 7, script: "console.log('hi'); return { n: fw.vars.get('n') + 1 }", vars: { n: 1 }, env: {} });
  assert.deepEqual(posted.at(-1), { source: 'fetchwing-sandbox', type: 'result', runId: 7, logs: [{ level: 'log', text: 'hi' }], value: { n: 2 } });
});

test('the generated sandbox reports a value it cannot send back', async () => {
  // Like postMessage, refuse to clone functions.
  const { posted, send } = loadSandbox(msg => { if (typeof msg.value?.f === 'function') throw new Error('DataCloneError'); });
  await send({ source: 'fetchwing-panel', type: 'logic', runId: 3, script: 'return { f: () => 1 }', vars: {}, env: {} });
  assert.deepEqual(posted.at(-1), { source: 'fetchwing-sandbox', type: 'result', runId: 3, logs: [], error: "Output can't be sent back from the script" });
});
