// Service worker: the only writer of workspace data, sends requests, and
// keeps the page mock scripts and the badge in step with enabled mocks.

import { applyMutation, emptyWorkspace } from './lib/model.js';
import { envVars, resolveRequest } from './lib/vars.js';
import { deriveActiveMocks, findDuplicate } from './lib/mocks.js';
import { executeSend } from './lib/send.js';

const SCRIPT_IDS = ['fw-bridge', 'fw-main'];
let nextRuleId = 1000;
const inFlight = new Map(); // requestId -> AbortController

let queue = Promise.resolve();
function enqueue(fn) {
  const run = queue.then(fn);
  queue = run.catch(() => {});
  return run;
}

async function loadWorkspace() {
  const { workspace } = await chrome.storage.local.get('workspace');
  if (workspace) return workspace;
  const fresh = emptyWorkspace();
  await chrome.storage.local.set({ workspace: fresh });
  return fresh;
}

const readWorkspace = () => enqueue(loadWorkspace);

async function publishMocks(ws) {
  const activeMocks = deriveActiveMocks(ws);
  await chrome.storage.local.set({ activeMocks });
  await chrome.action.setBadgeText({ text: activeMocks.length ? String(activeMocks.length) : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#d9480f' });
}

async function getMockSites() {
  const { mockSites } = await chrome.storage.local.get('mockSites');
  return mockSites || [];
}

async function syncContentScripts(origins) {
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: SCRIPT_IDS });
  if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: registered.map(s => s.id) });
  if (!origins.length) return;
  const matches = origins.map(o => `${o}/*`);
  await chrome.scripting.registerContentScripts([
    { id: 'fw-bridge', js: ['src/content/mock-bridge.js'], matches, runAt: 'document_start', allFrames: true },
    { id: 'fw-main', js: ['src/content/mock-main.js'], matches, runAt: 'document_start', allFrames: true, world: 'MAIN' },
  ]);
}

// Pages already open don't get registered scripts until reloaded.
async function injectIntoOpenTabs(origin) {
  const tabs = await chrome.tabs.query({ url: `${origin}/*` });
  for (const tab of tabs) {
    const target = { tabId: tab.id, allFrames: true };
    await chrome.scripting.executeScript({ target, files: ['src/content/mock-bridge.js'] }).catch(() => {});
    await chrome.scripting.executeScript({ target, files: ['src/content/mock-main.js'], world: 'MAIN' }).catch(() => {});
  }
}

function originOf(url) {
  try { return new URL(url).origin; } catch { return null; }
}

async function handle(msg) {
  switch (msg?.type) {
    case 'getWorkspace': {
      const [workspace, mockSites] = await Promise.all([readWorkspace(), getMockSites()]);
      return { workspace, mockSites };
    }
    case 'mutate': {
      let error = null;
      const ws = await enqueue(async () => {
        const current = await loadWorkspace();
        if (msg.mutation.type === 'setMockEnabled' && msg.mutation.enabled) {
          const other = findDuplicate(current, msg.mutation.id);
          if (other) {
            error = `Another mock for this request is already on: ${other.name}`;
            return current;
          }
        }
        const result = applyMutation(current, msg.mutation, Date.now());
        if (result.error) {
          error = result.error;
          return current;
        }
        await chrome.storage.local.set({ workspace: result.workspace });
        return result.workspace;
      });
      if (error) return { ok: false, error };
      await publishMocks(ws);
      return { ok: true };
    }
    case 'send': {
      const ws = await readWorkspace();
      const request = ws.items[msg.requestId];
      if (!request || request.deleted || request.type !== 'request') return { ok: false, error: 'Request not found' };
      const resolved = resolveRequest(request, envVars(ws));
      if (resolved.missing.length) return { ok: false, error: `Unresolved variables: ${resolved.missing.join(', ')}` };
      if (!originOf(resolved.url)) return { ok: false, error: 'Enter a full URL starting with http:// or https://' };
      nextRuleId = nextRuleId >= 1_000_000 ? 1000 : nextRuleId + 1;
      inFlight.get(msg.requestId)?.abort();
      const controller = new AbortController();
      inFlight.set(msg.requestId, controller);
      try {
        const response = await executeSend({
          resolved,
          fetchFn: (url, init) => fetch(url, init),
          dnr: chrome.declarativeNetRequest,
          now: () => performance.now(),
          ruleId: nextRuleId,
          signal: controller.signal,
        });
        return { ok: true, response };
      } catch (err) {
        if (controller.signal.aborted) return { ok: false, error: 'Cancelled', cancelled: true };
        return { ok: false, error: `Could not get a response: ${err?.message || err}` };
      } finally {
        if (inFlight.get(msg.requestId) === controller) inFlight.delete(msg.requestId);
      }
    }
    case 'cancelSend':
      inFlight.get(msg.requestId)?.abort();
      return { ok: true };
    case 'addMockSite':
    case 'removeMockSite': {
      const origin = originOf(msg.origin);
      if (!origin) return { ok: false, error: 'Invalid site' };
      const sites = await enqueue(async () => {
        const current = await getMockSites();
        const next = msg.type === 'addMockSite'
          ? [...new Set([...current, origin])]
          : current.filter(o => o !== origin);
        await chrome.storage.local.set({ mockSites: next });
        return next;
      });
      await syncContentScripts(sites);
      if (msg.type === 'addMockSite') await injectIntoOpenTabs(origin);
      return { ok: true, mockSites: sites };
    }
    // The DevTools panel may not have these APIs itself.
    case 'tabOrigin': {
      const tab = await chrome.tabs.get(msg.tabId).catch(() => null);
      return { origin: tab ? originOf(tab.url) : null };
    }
    case 'listAccess': {
      const { origins = [] } = await chrome.permissions.getAll();
      return { origins };
    }
    case 'removeAccess':
      await chrome.permissions.remove({ origins: [msg.pattern] }).catch(() => {});
      return { ok: true };
    default:
      return { ok: false, error: 'unknown_message' };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handle(msg).then(sendResponse, err => sendResponse({ ok: false, error: String(err?.message || err) }));
  return true;
});

async function startup() {
  const ws = await readWorkspace();
  await publishMocks(ws);
  await syncContentScripts(await getMockSites());
}
chrome.runtime.onInstalled.addListener(startup);
chrome.runtime.onStartup.addListener(startup);
