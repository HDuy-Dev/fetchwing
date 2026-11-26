// Run records kept in chrome.storage.session, one per flow. Pure helpers only.

import { upstream } from './flow-graph.js';

export const RECORD_PREFIX = 'flowRun:';
export const HEARTBEAT_MS = 2000;
export const STALE_MS = 6000;

export function newRecord({ flowId, runId, startedAt, snapshot }) {
  return {
    flowId,
    runId,
    status: 'running',
    startedAt,
    beatAt: startedAt,
    stopRequested: false,
    snapshot,
    blocks: {},
    totalMs: null,
  };
}

export function isAbandoned(record, now) {
  return record.status === 'running' && now - record.beatAt > STALE_MS;
}

export function abandon(record) {
  const blocks = {};
  for (const [id, b] of Object.entries(record.blocks || {})) {
    blocks[id] = b.state === 'running' || b.state === 'queued' ? { ...b, state: 'idle' } : b;
  }
  return { ...record, status: 'abandoned', blocks };
}

export function blockStatus(record, blockId, currentFingerprint) {
  const saved = record?.snapshot?.fingerprints?.[blockId];
  return { outdated: saved !== undefined && saved !== currentFingerprint };
}

const edgeKey = e => `${e.from}\u0000${e.to}`;

function sameUpstream(snapFlow, flow, blockId) {
  const ids = upstream(flow, blockId);
  const snapIds = upstream(snapFlow, blockId);
  if (snapIds.size !== ids.size || [...ids].some(id => !snapIds.has(id))) return false;
  const scope = new Set([blockId, ...ids]);
  const snapBlocks = new Map(snapFlow.blocks.map(b => [b.id, b]));
  const curBlocks = new Map(flow.blocks.map(b => [b.id, b]));
  for (const id of ids) {
    const a = snapBlocks.get(id);
    const b = curBlocks.get(id);
    if (!a || !b) return false;
    if (a.requestId !== b.requestId) return false;
    if (JSON.stringify(a.outputs || []) !== JSON.stringify(b.outputs || [])) return false;
  }
  const within = f => f.edges.filter(e => scope.has(e.from) && scope.has(e.to)).map(edgeKey).sort();
  return JSON.stringify(within(snapFlow)) === JSON.stringify(within(flow));
}

export function runFromHere(record, flow, blockId, { envChanged = false, outdatedIds = [] } = {}) {
  const off = { enabled: false, warn: null };
  if (!record) return off;
  const snapFlow = record.snapshot?.flow;
  if (!snapFlow || !snapFlow.blocks.some(b => b.id === blockId)) return off;
  const ids = upstream(flow, blockId);
  for (const id of ids) if (record.blocks?.[id]?.state !== 'ok') return off;
  if (!sameUpstream(snapFlow, flow, blockId)) return off;
  const outdated = new Set(outdatedIds);
  const stale = envChanged || [...ids].some(id => outdated.has(id));
  return { enabled: true, warn: stale ? 'Using outputs from an earlier run' : null };
}

export function fitRecords(records, maxBytes = 8_000_000) {
  const size = rs => JSON.stringify(rs).length;
  if (size(records) <= maxBytes) return records;
  const out = records.map(r => structuredClone(r));
  const oldestFirst = out.map((r, i) => i).sort((i, j) => out[i].startedAt - out[j].startedAt);
  for (const i of oldestFirst) {
    for (const b of Object.values(out[i].blocks || {})) {
      if (b.response && b.response.bodyText) {
        b.response.bodyText = '';
        b.response.dropped = true;
      }
    }
    if (size(out) <= maxBytes) break;
  }
  return out;
}
