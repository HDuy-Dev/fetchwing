// Runs a flow from this page and follows its run record in chrome.storage.session,
// so every place showing the flow sees the run, can stop it, and notices when the
// page running it went away.

import { runFlow } from '../lib/flow-run.js';
import { analyzeFlow, blockFingerprint, upstream } from '../lib/flow-graph.js';
import { RECORD_PREFIX, HEARTBEAT_MS, newRecord, isAbandoned, abandon, fitRecords } from '../lib/flow-record.js';
import { envVars, resolveRequest } from '../lib/vars.js';

export const ABANDONED_NOTE = 'Run stopped: the window running it was closed';
export const runFailedNote = err => `Run failed: ${err?.message || err}`;
const WATCH_MS = 2000;

const scopeOf = (flow, from) => id => from == null || id === from || upstream(flow, id).has(from);
const liveRequest = (ws, id) => {
  const item = ws.items?.[id];
  return item && item.type === 'request' && !item.deleted ? item : null;
};

// The origins a run will send to: blocks in scope that are neither mocked, deleted nor missing a variable.
export function flowOrigins(ws, flow, { from = null } = {}) {
  const env = envVars(ws);
  const info = analyzeFlow(ws, flow, env);
  const inScope = scopeOf(flow, from);
  const origins = new Set();
  for (const b of flow.blocks) {
    const entry = info.get(b.id);
    if (!inScope(b.id) || !entry?.request || entry.request.mock?.enabled) continue;
    if (entry.missing.length || entry.conflicts.length) continue;
    try {
      const url = new URL(resolveRequest(entry.request, env).url);
      if (url.protocol === 'http:' || url.protocol === 'https:') origins.add(url.origin);
    } catch { /* not a full URL yet: the send reports it */ }
  }
  return [...origins];
}

// options: { flowId, getWs, send(msg), storage (chrome.storage.session), onRecord(record|null), now?, timers? }
export function createRunner({ flowId, getWs, send, storage, onRecord = () => {}, now = Date.now, timers = globalThis }) {
  const key = RECORD_PREFIX + flowId;
  let record = null;
  let loaded = false;
  let watching = true;
  let active = null; // this page's run: { runId, controller, keys }
  let ownRunId = null;
  let writes = Promise.resolve();

  const show = () => {
    if (!watching) return;
    try { onRecord(record); } catch { /* listener error */ }
  };
  // Writes go out in order. Over the storage quota, the record is written without
  // response bodies, so the heartbeat and states still reach the other places.
  const write = next => {
    record = next;
    show();
    writes = writes
      .then(() => storage.set({ [key]: next }))
      .catch(() => storage.set({ [key]: fitRecords([next], 0)[0] }))
      .catch(() => {});
    return writes;
  };
  const isLive = () => Boolean(record && record.status === 'running' && !isAbandoned(record, now()));

  function checkAbandoned() {
    if (active || !record || !isAbandoned(record, now())) return;
    write({ ...abandon(record), note: ABANDONED_NOTE });
  }

  function stopActive() {
    if (!active || active.controller.signal.aborted) return;
    active.controller.abort();
    for (const k of active.keys) send({ type: 'cancelSend', key: k });
  }

  // Two runs started in two places within one storage round trip: the earlier one wins.
  const startsBefore = (a, b) => a.startedAt < b.startedAt || (a.startedAt === b.startedAt && a.runId < b.runId);

  // storage is one area (StorageArea.onChanged passes only the changes).
  function onChanged(changes) {
    if (!(key in changes)) return;
    const next = changes[key].newValue ?? null;
    if (next && next.runId === ownRunId && (active || next.status === 'running')) {
      // Our own writes echo back; only another page's stop or abandon matters here.
      if (active && (next.stopRequested || next.status !== 'running')) stopActive();
      return;
    }
    if (active) {
      // Another run's record never takes this run's results.
      if (next?.status === 'running' && startsBefore(next, record)) {
        active.yielded = true;
        stopActive();
      } else {
        // A later run, or a stale write (an old record, a removal): put this run's record back.
        write(record);
        return;
      }
    }
    loaded = true;
    record = next;
    show();
    checkAbandoned();
  }
  storage.onChanged.addListener(onChanged);

  storage.get(key).then(got => {
    if (loaded || active) return;
    loaded = true;
    record = got[key] ?? null;
    show();
    checkAbandoned();
  }).catch(() => {});

  const watch = timers.setInterval(checkAbandoned, WATCH_MS);

  // Shrinks the bodies of finished records when all of them together are too big.
  async function fitAll() {
    const all = await storage.get(null);
    const keys = Object.keys(all).filter(k => k.startsWith(RECORD_PREFIX));
    const list = keys.map(k => all[k]);
    const fitted = fitRecords(list);
    if (fitted === list) return;
    const changed = keys.filter((k, i) => fitted[i].status !== 'running' && JSON.stringify(fitted[i]) !== JSON.stringify(list[i]));
    if (!changed.length) return;
    // Read again just before writing: a record replaced meanwhile (a new run) is left alone.
    const fresh = await storage.get(changed);
    const out = {};
    for (const k of changed) {
      const i = keys.indexOf(k);
      if (JSON.stringify(fresh[k]) === JSON.stringify(list[i])) out[k] = fitted[i];
    }
    if (out[key] && record?.runId === out[key].runId) record = out[key];
    if (Object.keys(out).length) await storage.set(out);
  }

  async function run({ from = null } = {}) {
    if (active || isLive()) return false;
    const ws = getWs();
    const current = ws?.flows?.[flowId];
    if (!current || current.deleted) return false;
    // The run uses a snapshot taken now; edits made meanwhile apply to the next run.
    const flow = structuredClone(current);
    const env = envVars(ws);
    const previous = from ? record : null;
    const inScope = scopeOf(flow, from);
    const fingerprints = {};
    const blocks = {};
    for (const b of flow.blocks) {
      if (!inScope(b.id)) {
        // Out-of-scope results are reused, so keep what produced them.
        const fp = previous?.snapshot?.fingerprints?.[b.id];
        if (fp !== undefined) fingerprints[b.id] = fp;
        blocks[b.id] = previous?.blocks?.[b.id] ?? { state: 'idle' };
        continue;
      }
      const request = liveRequest(ws, b.requestId);
      if (request) fingerprints[b.id] = blockFingerprint(request, env);
    }
    const runId = crypto.randomUUID();
    const keys = new Set();
    const controller = new AbortController();
    const mine = { runId, controller, keys, yielded: false };
    active = mine;
    ownRunId = runId;
    loaded = true;
    let beat = null;
    let result = null;
    let failure = null;
    try {
      write({
        ...newRecord({ flowId, runId, startedAt: now(), snapshot: { flow, fingerprints, envId: ws.activeEnvId ?? null, envVars: env } }),
        blocks,
        from,
        scope: flow.blocks.filter(b => inScope(b.id)).map(b => b.id),
      });
      // A run that yielded to an earlier one stops writing at once.
      const put = next => { if (!mine.yielded) write(next); };
      beat = timers.setInterval(() => put({ ...record, beatAt: now() }), HEARTBEAT_MS);
      result = await runFlow({
        flow, ws, envVars: env, runId, from, previous, signal: controller.signal,
        send: async ({ requestId, vars, key: sendKey }) => {
          keys.add(sendKey);
          try { return await send({ type: 'send', requestId, vars, key: sendKey }); } finally { keys.delete(sendKey); }
        },
        onUpdate: (id, res) => put({ ...record, blocks: { ...record.blocks, [id]: res } }),
      });
    } catch (err) {
      failure = err;
      controller.abort();
      for (const k of keys) send({ type: 'cancelSend', key: k });
    } finally {
      if (beat !== null) timers.clearInterval(beat);
      active = null;
    }
    try {
      if (mine.yielded) {
        // The earlier run owns the record; show it, and write nothing.
        const got = await storage.get(key);
        record = got[key] ?? null;
        show();
      } else if (failure) {
        await write({ ...abandon(record), status: 'stopped', note: runFailedNote(failure), beatAt: now() });
      } else {
        await write({ ...record, status: result.stopped ? 'stopped' : 'done', totalMs: result.totalMs, blocks: result.blocks, beatAt: now() });
        await fitAll().catch(() => {});
      }
    } finally {
      if (!watching) storage.onChanged.removeListener(onChanged);
    }
    if (failure) throw failure;
    return !mine.yielded;
  }

  return {
    get record() { return record; },
    isLive,
    isRunning: () => Boolean(active),
    run,
    // Stops this page's run, or asks the page running it to stop.
    stop() {
      if (active) stopActive();
      else if (isLive()) write({ ...record, stopRequested: true });
    },
    // A run this page started keeps going after the view is gone; only the watching ends.
    dispose() {
      watching = false;
      timers.clearInterval(watch);
      if (!active) storage.onChanged.removeListener(onChanged);
    },
  };
}
