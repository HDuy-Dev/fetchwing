// Running a flow: send each block once its upstream blocks are ok, feeding
// their outputs into later requests as {{variables}}.

import { analyzeFlow, topoOrder, upstream, blockFingerprint } from './flow-graph.js';
import { readOutput } from './flow-path.js';
import { resolveRequest, withFlowVars } from './vars.js';

const DEAD = new Set(['failed', 'skipped', 'missing']);

export function mockResult(mock) {
  const body = String(mock.body ?? '');
  const headers = (mock.headers || []).filter(h => h.enabled !== false && h.key).map(h => [h.key, h.value]);
  if (!headers.length && isJson(body)) headers.push(['content-type', 'application/json']);
  return {
    status: mock.status,
    statusText: '',
    timeMs: mock.delayMs || 0,
    sizeBytes: new TextEncoder().encode(body).length,
    headers,
    bodyText: body,
    bodyTruncated: false,
  };
}

function isJson(text) {
  if (!text.trim()) return false;
  try { JSON.parse(text); return true; } catch { return false; }
}

function sentOf(resolved) {
  const { mode, raw, fields } = resolved.body;
  const body = mode === 'json' || mode === 'text'
    ? raw
    : fields.filter(f => f.enabled && f.key).map(f => [f.key, f.value]);
  return { method: resolved.method, url: resolved.url, headers: resolved.headers, body };
}

export function runFlow(opts) {
  const {
    flow, ws, envVars = {}, send, signal, onUpdate = () => {},
    now = Date.now, sleep = ms => new Promise(r => setTimeout(r, ms)),
    from = null, previous = null,
  } = opts;
  const concurrency = Math.max(1, Math.floor(opts.concurrency ?? 6) || 1);
  const runId = opts.runId ?? crypto.randomUUID();
  const t0 = now();
  const at = () => now() - t0;
  const info = analyzeFlow(ws, flow, envVars);
  const order = topoOrder(flow);
  const byId = new Map(flow.blocks.map(b => [b.id, b]));
  const parents = new Map(order.map(id => [id, [...new Set(flow.edges.filter(e => e.to === id && byId.has(e.from)).map(e => e.from))]]));
  const inScope = id => from == null || id === from || upstream(flow, id).has(from);
  const blocks = {};
  // A throwing listener must not leave the run half-updated, so its errors are ignored.
  const set = (id, result) => {
    blocks[id] = result;
    try { onUpdate(id, result); } catch { /* listener error */ }
  };
  const errorText = e => e?.message || String(e);

  // Before sending: copy out-of-scope blocks, settle the ones that can never be sent, queue the rest.
  for (const id of order) {
    if (!inScope(id)) {
      blocks[id] = previous?.blocks?.[id] ?? { state: 'idle' };
      continue;
    }
    const entry = info.get(id);
    if (entry.deleted) set(id, { state: 'failed', errorKind: 'deleted', error: 'The request was deleted' });
    else if (entry.conflicts.length) set(id, { state: 'missing', errorKind: 'conflict', error: `More than one block provides: ${entry.conflicts.join(', ')}` });
    else if (entry.missing.length) set(id, { state: 'missing', errorKind: 'missing', error: `Missing variables: ${entry.missing.join(', ')}` });
    else set(id, { state: 'queued' });
  }

  // Rejects when the engine itself throws (e.g. a request it can't resolve), so callers never wait forever.
  return new Promise((resolve, reject) => {
    let inFlight = 0;
    let stopped = false;
    let finished = false;

    const fail = err => {
      if (finished) return;
      finished = true;
      stopped = true;
      signal?.removeEventListener('abort', onAbort);
      reject(err);
    };

    const finish = () => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener('abort', onAbort);
      resolve({ blocks, totalMs: at(), stopped });
    };

    function onAbort() {
      if (finished) return;
      stopped = true;
      for (const id of order) {
        const s = blocks[id].state;
        if (s === 'running') set(id, { ...blocks[id], state: 'failed', errorKind: 'cancelled', error: 'Stopped', endMs: at() });
        else if (s === 'queued') set(id, { state: 'idle' });
      }
      finish();
    }

    // A parent is a dead end if it ended badly, or sits outside the run without an ok result.
    const deadEnd = p => DEAD.has(blocks[p].state) || (!inScope(p) && blocks[p].state !== 'ok');

    function start(id) {
      if (stopped) return;
      const block = byId.get(id);
      const { request, uses } = info.get(id);
      const flowVars = {};
      const unset = [];
      for (const { name, from: source } of uses) {
        if (source === 'env') continue;
        const outputs = blocks[source]?.outputs || {};
        if (Object.prototype.hasOwnProperty.call(outputs, name)) flowVars[name] = outputs[name];
        else unset.push(name);
      }
      if (unset.length) {
        set(id, { state: 'missing', errorKind: 'missing', error: `Missing variables: ${unset.join(', ')}` });
        return;
      }
      const sent = sentOf(resolveRequest(request, withFlowVars(envVars, flowVars)));
      const base = { sent, startMs: at(), fingerprint: blockFingerprint(request, envVars), mock: Boolean(request.mock?.enabled) };
      set(id, { ...base, state: 'running' });
      if (stopped) return; // aborted by the listener
      inFlight++;
      exec(id, block, request, flowVars).then(res => {
        inFlight--;
        if (stopped) return;
        let result;
        try {
          result = settle(block, res);
        } catch (e) {
          result = { state: 'failed', errorKind: 'network', error: errorText(e) };
        }
        set(id, { ...base, ...result, endMs: at() });
        pump();
      }).catch(fail);
    }

    async function exec(id, block, request, vars) {
      try {
        if (request.mock?.enabled) {
          await sleep(request.mock.delayMs || 0);
          return { ok: true, response: mockResult(request.mock) };
        }
        return await send({ blockId: id, requestId: block.requestId, vars, key: `${runId}:${id}`, signal });
      } catch (e) {
        return { ok: false, error: errorText(e) };
      }
    }

    function settle(block, res) {
      if (!res.ok) return { state: 'failed', errorKind: res.cancelled ? 'cancelled' : 'network', error: res.error };
      const response = res.response;
      if (response.status >= 400) return { state: 'failed', errorKind: 'http', error: `HTTP ${response.status}`, response };
      const outputs = {};
      for (const { name, path } of block.outputs || []) {
        const read = readOutput(response, path);
        if (read.error === 'truncated') {
          return { state: 'failed', errorKind: 'truncated', error: `The response was cut off before ${path}`, response, outputs };
        }
        if (read.found) outputs[name] = read.value;
      }
      return { state: 'ok', response, outputs };
    }

    function pump() {
      if (stopped || finished) return;
      let progress = true;
      while (progress) {
        progress = false;
        for (const id of order) {
          if (stopped) return; // a listener may abort mid-pass
          if (blocks[id].state !== 'queued') continue;
          const ps = parents.get(id);
          if (ps.some(deadEnd)) {
            set(id, { state: 'skipped' });
            progress = true;
          } else if (inFlight < concurrency && ps.every(p => blocks[p].state === 'ok')) {
            start(id);
            progress = true;
          }
        }
      }
      if (inFlight === 0) {
        // Anything still queued can never become ready (a cycle).
        for (const id of order) if (blocks[id].state === 'queued') set(id, { state: 'skipped' });
        finish();
      }
    }

    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort, { once: true });
    pump();
  });
}
