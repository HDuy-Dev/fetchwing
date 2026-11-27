import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createScriptRunner } from '../src/panel/script-runner.js';
import { runScript } from '../src/lib/script-runtime.js';
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
        runScript(msg.script, { response: msg.response, vars: msg.vars }).then(result => {
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
