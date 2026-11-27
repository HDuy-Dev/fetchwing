// The details column of a flow: the selected block's inputs and outputs, response,
// request and headers, or an overview of the last run when no block is selected.

import { fingerprintOf, isLogic, upstream } from '../lib/flow-graph.js';
import { detectOutputs } from '../lib/logic-block.js';
import { blockStatus } from '../lib/flow-record.js';
import { parsePath, pathFor, toText } from '../lib/flow-path.js';
import { midEllipsis, isSensitiveName, isSensitiveHeader } from '../lib/flow-view.js';
import { envVars, VAR_PATTERN } from '../lib/vars.js';
import { pathOf } from '../lib/model.js';
import { parseJson, pathKey, renderJsonView } from './json-view.js';
import { formatSize } from './response-view.js';
import { bindHandle } from './split.js';
import { el, icon, iconButton, toast } from './ui.js';

const TABS = [['io', 'Inputs / Outputs'], ['response', 'Response'], ['request', 'Request'], ['headers', 'Headers']];
export const LOGIC_TABS = [['script', 'Script'], ['io', 'Inputs / Outputs'], ['console', 'Console']];
const SCRIPT_HINT = "fw.vars.get('x') · return { name: value } · console.log() · env values are text: use Number(...)";
const MAX_CONSOLE_TEXT = 256_000;
const SAVE_DELAY = 400;
const ICON = { idle: '', queued: '', running: '', ok: '✓', bad: '✕', skip: '⊘', warn: '!' };
const CLASS = { ok: 'ok', failed: 'bad', skipped: 'skip', missing: 'warn', running: 'running', queued: 'queued' };
const TEXT = { idle: 'Not run', queued: 'Queued', running: 'Running…', skipped: 'Skipped', missing: 'Missing variable' };
const OUTDATED = 'The request changed after this run; this response is outdated.';
const OUTDATED_REQUEST = 'The request changed after this run: this is the request now, with values from that run.';
const DEFAULT_W = 440, MIN_W = 280, LONG = 44, MASK = '••••••••';
const has = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);
const ms = n => `${Math.round(n)} ms`;
const done = r => r?.state === 'ok' || r?.state === 'failed';

// ---------- pure helpers ----------
function walkPaths(value, steps, at, out) {
  if (!steps.length) return out.push(at);
  const [step, ...rest] = steps;
  if (step.all) {
    if (Array.isArray(value)) value.forEach((v, i) => walkPaths(v, rest, [...at, i], out));
  } else if ('index' in step) {
    if (Array.isArray(value) && step.index < value.length) walkPaths(value[step.index], rest, [...at, step.index], out);
  } else if (value && typeof value === 'object' && !Array.isArray(value) && has(value, step.key)) {
    walkPaths(value[step.key], rest, [...at, step.key], out);
  }
}

// Which lines of a JSON body the outputs read: Map of pathKey -> output name(s).
export function outputHighlights(body, outputs) {
  const map = new Map();
  for (const { name, path } of outputs || []) {
    const parsed = parsePath(path);
    if (!parsed.ok || parsed.steps[0].key !== 'body') continue;
    const found = [];
    walkPaths(body, parsed.steps.slice(1), [], found);
    for (const p of found) {
      const k = pathKey(p);
      map.set(k, map.has(k) ? `${map.get(k)}, ${name}` : name);
    }
  }
  return map;
}

// The output "＋ Output" adds for a JSON line: named after its last key, made unique with a number.
export function newOutputFor(path, outputs) {
  const base = String([...path].reverse().find(k => typeof k === 'string') ?? '').replace(/[{}]/g, '').trim() || 'value';
  const taken = new Set((outputs || []).map(o => o.name));
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base}${n}`;
  return { name, path: pathFor(path) };
}

// Why an output name can't be saved, or null. `index` is the row being edited (-1 for a new one).
export function outputNameError(name, outputs, index) {
  const n = name.trim();
  if (!n) return 'Name is required';
  if (/[{}]/.test(n)) return 'Name can’t contain { or }';
  if (outputs.some((o, i) => i !== index && o.name === n)) return `An output named ${n} already exists`;
  return null;
}

const cut = text => (text.length > MAX_CONSOLE_TEXT ? `${text.slice(0, MAX_CONSOLE_TEXT)}… (truncated)` : text);

// The Console tab of a logic block: logs, warnings, the error, then what the script returned.
export function logicConsole(result) {
  if (!result) return [];
  const rows = (result.logs || []).map(({ level, text }) => ({ level, text: cut(String(text)) }));
  for (const w of result.warnings || []) rows.push({ level: 'warn', text: cut(w) });
  if (result.error !== undefined && result.state === 'failed') rows.push({ level: 'error', text: cut(String(result.error)) });
  if (result.state === 'ok' && result.value !== undefined) {
    let json;
    try { json = JSON.stringify(result.value); } catch { json = String(result.value); }
    rows.push({ level: 'info', text: cut(`Returned: ${json}`) });
  }
  return rows;
}

// Why an output can't be saved, or null. `index` is the row being edited (-1 for a new one).
export function outputError(name, path, outputs, index) {
  const nameError = outputNameError(name, outputs, index);
  if (nameError) return nameError;
  const parsed = parsePath(path);
  return parsed.ok ? null : parsed.error;
}

// The environment values a block's view shows, and which are secret. From the run's snapshot,
// secret flags come from the environment that run used; if it is gone, every value is masked.
export function envView(ws, run, fromSnapshot) {
  const secretsOf = env => new Set((env?.vars || []).filter(v => v.secret).map(v => v.key));
  if (fromSnapshot) {
    const env = ws.environments?.[run.snapshot.envId];
    const secrets = env && !env.deleted ? secretsOf(env) : null;
    return { vars: run.snapshot.envVars, secret: name => !secrets || secrets.has(name) };
  }
  const secrets = secretsOf(ws.environments?.[ws.activeEnvId]);
  return { vars: envVars(ws), secret: name => secrets.has(name) };
}

// options: { onGo(blockId), onChange(patch), onClose(), onOpenRequest?(requestId), store? }
export function createDetails(container, { onGo, onChange, onClose, onOpenRequest, store }) {
  const grip = el('div', { class: 'dt-grip', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Resize details', tabindex: '0', title: 'Drag to resize, double-click to reset' });
  const head = el('div', { class: 'dt-head' });
  const tabsEl = el('div', { class: 'dt-tabs', role: 'tablist', 'aria-label': 'Block details' });
  const body = el('div', { class: 'dt-body' });
  const root = el('aside', { class: 'flow-details', 'aria-label': 'Details' }, grip, head, tabsEl, body);
  container.append(root);

  // The open tab is kept per kind of block: request blocks and logic blocks have different tabs.
  const pick = (saved, list, fallback) => (list.some(([id]) => id === saved) ? saved : fallback);
  const tabs = {
    request: pick(store?.get('flowTab', 'io'), TABS, 'io'),
    logic: pick(store?.get('flowLogicTab', 'script'), LOGIC_TABS, 'script'),
  };
  let tab = tabs.request;
  let draft = null; // { id, text }: script typed but not saved yet
  let saveTimer = null;
  let c = null; // the last render's { ws, flow, run, analysis, id }
  let sig = null, shownBlock, painted = '';
  let q = '', raw = false, max = false, editing = null; // editing: { index, name, path, error }
  const revealed = new Set(), expanded = new Set();

  // ---------- width ----------
  const range = () => {
    const room = container.clientWidth;
    return { min: Math.min(MIN_W, room), max: Math.max(Math.min(MIN_W, room), room < 640 ? room - 24 : room - 220) };
  };
  const clamp = w => { const r = range(); return Math.round(Math.min(r.max, Math.max(r.min, w))); };
  const applyWidth = () => {
    if (!container.clientWidth) return;
    const w = clamp(store?.get('flowDetailsWidth', null) ?? DEFAULT_W);
    root.style.setProperty('--details-w', `${w}px`);
    grip.setAttribute('aria-valuenow', w);
  };
  const saveWidth = w => { store?.set('flowDetailsWidth', w === null ? null : clamp(w)); applyWidth(); };
  bindHandle(grip, { pos: 'clientX', dir: -1, keys: ['ArrowRight', 'ArrowLeft'], size: () => root.offsetWidth, resize: saveWidth, reset: () => saveWidth(null) });
  const sizeWatch = new ResizeObserver(applyWidth);
  sizeWatch.observe(container);

  // ---------- small parts ----------
  const blockOf = id => c.flow.blocks.find(b => b.id === id);
  const nameOf = id => {
    const b = blockOf(id);
    if (isLogic(b)) return b.name || 'Logic';
    return c.analysis.get(id)?.request?.name ?? c.ws.items?.[b?.requestId]?.name ?? 'Deleted request';
  };
  const link = id => el('button', { type: 'button', class: 'nlink', title: nameOf(id), onclick: e => { e.stopPropagation(); onGo(id); } }, nameOf(id));
  const links = ids => ids.flatMap((id, i) => (i ? [', ', link(id)] : [link(id)]));
  const sect = (title, count, ...kids) => el('div', { class: 'dt-sect' },
    el('h4', {}, title, count != null ? el('span', { class: 'count' }, String(count)) : null), ...kids);
  const dim = text => el('div', { class: 'dt-dim' }, text);
  const note = (cls, ...kids) => el('div', { class: `dt-note ${cls}` }, ...kids);
  const banner = (cls, ...kids) => el('div', { class: `dt-banner ${cls}`, role: 'status' }, ...kids);
  const copy = text => el('button', { type: 'button', class: 'cp', title: 'Copy', 'aria-label': 'Copy', onclick: async () => {
    try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Copy failed'); }
  } }, '⧉');
  const status = (cls, text) => el('span', { class: `st s-${cls}` }, el('span', { class: 'ico', 'aria-hidden': 'true' }, ICON[cls] ?? ''), text);
  const outdatedOf = id => {
    const b = blockOf(id);
    if (!b || !done(c.run?.blocks?.[id])) return false;
    const fp = fingerprintOf(c.ws, b, envVars(c.ws));
    return fp !== null && blockStatus(c.run, id, fp).outdated;
  };

  // A value: masked until ◉ when secret, cut in the middle when long (click shows all), copy on hover.
  function valueCell(text, { key, secret = false, prefix = '', revealAs = null }) {
    const node = el('span', { class: 'val' });
    const draw = focusEye => {
      const shown = !secret || revealed.has(key);
      let content;
      if (!shown) content = el('span', { class: 'mask' }, prefix + MASK);
      else if (revealAs) content = revealAs();
      else if (text.length > LONG && !expanded.has(key)) {
        content = el('button', { type: 'button', class: 'trunc', title: 'Click to show all', onclick: () => { expanded.add(key); draw(); } }, midEllipsis(text, LONG));
      } else content = el('span', { class: 'full' }, text);
      const eye = secret ? el('button', { type: 'button', class: 'eye', title: shown ? 'Hide value' : 'Show value', 'aria-label': shown ? 'Hide value' : 'Show value',
        onclick: () => { if (shown) revealed.delete(key); else revealed.add(key); draw(true); } }, shown ? '◎' : '◉') : null;
      node.replaceChildren(content, eye ?? '', copy(text));
      if (focusEye) eye?.focus();
    };
    draw();
    return node;
  }

  // ---------- variables of the selected block ----------
  function varInfo(id) {
    const entry = c.analysis.get(id);
    const { vars: env, secret } = envView(c.ws, c.run, Boolean(c.run?.snapshot?.envVars && done(c.run.blocks?.[id])));
    const info = new Map();
    for (const { name, from } of entry?.uses || []) {
      if (from === 'env') info.set(name, { from, value: has(env, name) ? env[name] : undefined, secret: secret(name) });
      else if (from) {
        const r = c.run?.blocks?.[from];
        info.set(name, { from, value: r?.state === 'ok' && has(r.outputs, name) ? toText(r.outputs[name]) : undefined, secret: isSensitiveName(name) });
      } else info.set(name, { from: null, conflict: entry.conflicts.includes(name) });
    }
    return info;
  }

  // Text with each {{name}} shown as a chip holding the name and its value.
  function chipify(text, vars, show = false) {
    const s = String(text ?? '');
    const out = [];
    let last = 0;
    for (const m of s.matchAll(VAR_PATTERN)) {
      out.push(s.slice(last, m.index));
      last = m.index + m[0].length;
      const v = vars.get(m[1]);
      if (!v?.from) {
        out.push(el('span', { class: 'vchip miss', title: `${m[1]}: ${v?.conflict ? 'more than one source' : 'no source'}` }, el('span', { class: 'vn' }, m[1]), el('span', { class: 'vv' }, '?')));
        continue;
      }
      const source = v.from === 'env' ? 'environment' : nameOf(v.from);
      const hidden = v.secret && !show && !revealed.has(`chip:${m[1]}`);
      const vv = v.value === undefined ? null : el('span', { class: 'vv', title: hidden ? null : v.value }, hidden ? '••••••' : v.value);
      out.push(el('span', { class: 'vchip', title: `${m[1]} ← ${source}` }, el('span', { class: 'vn' }, m[1]), vv,
        v.secret && v.value !== undefined && !show ? el('button', { type: 'button', class: 'eye', 'aria-label': hidden ? 'Show value' : 'Hide value', title: hidden ? 'Show value' : 'Hide value',
          onclick: () => { const k = `chip:${m[1]}`; if (hidden) revealed.add(k); else revealed.delete(k); paint(); } }, hidden ? '◉' : '◎') : null));
    }
    out.push(s.slice(last));
    return out.filter(x => x !== '');
  }

  // ---------- why a block has no result ----------
  function reason(id, entry, result) {
    const state = result?.state ?? 'idle';
    const parents = [...new Set(c.flow.edges.filter(e => e.to === id).map(e => e.from))].filter(blockOf);
    if (entry?.deleted) return banner('bad', 'This block’s request was deleted, so it can’t run.');
    if (state === 'missing' || (state === 'idle' && (entry?.missing.length || entry?.conflicts.length))) {
      const envName = c.ws.environments?.[c.ws.activeEnvId]?.name;
      const lines = [];
      for (const n of entry?.missing || []) lines.push([`Not sent: {{${n}}} has no value. Connect a block that outputs it, or add it to ${envName ? `the "${envName}" environment` : 'an environment'}.`]);
      for (const n of entry?.conflicts || []) {
        const ups = upstream(c.flow, id);
        const providers = c.flow.blocks.filter(b => ups.has(b.id) && (b.outputs || []).some(o => o.name === n)).map(b => b.id);
        lines.push([`Not sent: more than one block provides {{${n}}}: `, ...links(providers), '.']);
      }
      if (state === 'missing') {
        for (const { name, from } of entry?.uses || []) {
          if (from && from !== 'env' && c.run?.blocks?.[from]?.state === 'ok' && !has(c.run.blocks[from].outputs, name)) {
            lines.push([`Not sent: {{${name}}} was not found in the response of `, link(from), '.']);
          }
        }
      }
      if (!lines.length) lines.push([result?.error || 'Not sent: a variable has no value.']);
      return banner('warn', ...lines.map(l => el('div', {}, ...l)));
    }
    if (state === 'skipped') {
      const dead = parents.filter(p => c.run?.blocks?.[p]?.state !== 'ok');
      return banner('skip', 'Skipped because an earlier block failed: ', ...links(dead), '.');
    }
    if (state === 'queued') {
      const waiting = parents.filter(p => c.run?.blocks?.[p]?.state !== 'ok');
      return banner('skip', 'Waiting for earlier blocks to finish', ...(waiting.length ? [': ', ...links(waiting), '.'] : ['.']));
    }
    if (state === 'running') return banner('skip', entry?.logic ? 'Running script…' : result.mock ? 'Waiting for the mock…' : 'Sending request…');
    if (state === 'idle') return banner('skip', c.run && c.run.status !== 'running' && c.run.status !== 'done' ? 'Not run: the run stopped before this block.' : 'Not run yet. Press Run to run the flow.');
    return null;
  }

  // ---------- header ----------
  const acts = () => el('span', { class: 'acts' },
    el('button', { type: 'button', dataset: { key: 'max' }, title: max ? 'Restore' : 'Expand', 'aria-label': max ? 'Restore details' : 'Expand details', 'aria-pressed': String(max), onclick: () => { max = !max; root.classList.toggle('max', max); paint(); } }, '⤢'),
    el('button', { type: 'button', dataset: { key: 'close' }, title: 'Close (Esc)', 'aria-label': 'Close details', onclick: close }, '✕'));

  function blockHead(id, entry, result) {
    const request = entry?.request;
    const state = result?.state ?? 'idle';
    const cls = entry?.deleted && !done(result) ? 'bad' : CLASS[state] ?? 'idle';
    const r = result?.response;
    let text = TEXT[state] ?? state;
    if (done(result) && entry?.logic) text = state === 'ok' ? 'Done' : result.error || 'Failed';
    else if (done(result)) text = r ? `${r.status} ${r.statusText || ''}`.trim() : result.error || 'Failed';
    else if (entry?.deleted) text = 'Request deleted';
    else if (state === 'idle' && (entry?.missing.length || entry?.conflicts.length)) text = TEXT.missing;
    const ran = result?.endMs != null && result?.startMs != null ? result.endMs - result.startMs : null;
    const meta = [
      status(cls, text),
      ran != null ? ms(ran) : null,
      r && done(result) && !r.dropped && r.sizeBytes != null ? formatSize(r.sizeBytes) : null,
      result?.startMs != null ? el('span', { title: `Waited ${ms(result.startMs)} for earlier blocks, then ran ${ran != null ? ms(ran) : '…'}` }, `started +${ms(result.startMs)}`) : null,
    ].filter(Boolean).flatMap((p, i) => (i ? [el('span', { class: 'sep', 'aria-hidden': 'true' }, '·'), p] : [p]));
    const name = nameOf(id);
    const mocked = done(result) ? result.mock : request?.mock?.enabled;
    const logic = Boolean(entry?.logic);
    head.replaceChildren(
      el('div', { class: 'dt-top' },
        logic ? el('span', { class: 'm JS' }, 'JS') : request ? el('span', { class: `m ${request.method}` }, request.method) : null,
        logic ? nameInput(id) : el('h3', { class: 'dt-name', title: name }, name),
        mocked ? el('span', { class: 'badge', title: 'Answered by the mock' }, 'MOCK') : null,
        outdatedOf(id) ? el('span', { class: 'stale', title: logic ? 'The script changed after this run' : 'The request changed after this run' }, 'outdated') : null,
        acts()),
      el('div', { class: 'dt-meta' }, meta));
  }

  const kindOf = id => (isLogic(blockOf(id)) ? 'logic' : 'request');
  const tabList = id => (kindOf(id) === 'logic' ? LOGIC_TABS : TABS);

  function drawTabs(id, entry, result) {
    const b = blockOf(id);
    const reqHeaders = (entry?.request?.headers || []).filter(h => h.enabled && h.key).length;
    const rows = entry?.logic ? logicConsole(result) : [];
    const counts = { io: (entry?.uses.length ?? 0) + (b.outputs?.length ?? 0), headers: reqHeaders + (result?.response?.headers?.length ?? 0), console: rows.length };
    const errorDot = rows.some(r => r.level === 'error');
    tabsEl.hidden = false;
    tabsEl.replaceChildren(...tabList(id).map(([t, label]) => el('button', {
      type: 'button', role: 'tab', class: t === tab ? 'on' : '', 'aria-selected': String(t === tab), tabindex: t === tab ? '0' : '-1', dataset: { key: `tab-${t}`, tab: t },
      onclick: () => setTab(t),
    }, label, counts[t] ? el('span', { class: 'count' }, String(counts[t])) : null,
      t === 'console' && errorDot ? el('span', { class: 'err-dot', title: 'The script failed', 'aria-label': 'error' }) : null)));
  }

  function setTab(t) {
    tab = t;
    const kind = c?.id ? kindOf(c.id) : 'request';
    tabs[kind] = t;
    store?.set(kind === 'logic' ? 'flowLogicTab' : 'flowTab', t);
    paint();
  }

  // ---------- logic blocks ----------
  const saveBlock = (id, patch) => Promise.resolve(onChange({ blocks: c.flow.blocks.map(x => (x.id === id ? { ...x, ...patch } : x)) }))
    .then(res => { if (res?.ok === false) toast(res.error ? `Could not save: ${res.error}` : 'Could not save the block'); return res; });

  function nameInput(id) {
    const b = blockOf(id);
    const commit = input => {
      const name = input.value.trim() || 'Logic';
      input.value = name;
      if (name !== (b.name || 'Logic')) saveBlock(id, { name });
    };
    return el('input', { type: 'text', class: 'dt-name dt-name-input', value: b.name || 'Logic', 'aria-label': 'Block name', spellcheck: 'false', dataset: { key: 'logic-name' },
      onblur: e => commit(e.target),
      onkeydown: e => {
        if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); e.target.value = b.name || 'Logic'; e.target.blur(); }
      } });
  }

  function flushScript() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (!draft || !c) return;
    const b = blockOf(draft.id);
    const { id, text } = draft;
    if (!b || b.script === text) { draft = null; return; }
    saveBlock(id, { script: text }).then(() => { if (draft?.id === id && draft.text === text) draft = null; });
  }

  function scriptTab(id) {
    const b = blockOf(id);
    if (draft && draft.id === id && draft.text === b.script) draft = null;
    const text = draft?.id === id ? draft.text : b.script ?? '';
    const area = el('textarea', { class: 'code-area dt-script', spellcheck: 'false', 'aria-label': 'Script', placeholder: "const total = Number(fw.vars.get('price')) * 2;\nreturn { total };", dataset: { key: 'script' },
      oninput: e => {
        draft = { id, text: e.target.value };
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(flushScript, SAVE_DELAY);
      },
      onblur: flushScript });
    area.value = text;
    const outputs = b.outputs || [];
    const newName = el('input', { type: 'text', placeholder: 'Output name', 'aria-label': 'New output name', spellcheck: 'false', dataset: { key: 'logic-out-name' },
      onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); addOutput(); } } });
    const error = el('div', { class: 'out-error', role: 'alert', hidden: true });
    function addOutput() {
      const problem = outputNameError(newName.value, outputs, -1);
      if (problem) { error.textContent = problem; error.hidden = false; return; }
      saveOutputs(b, [...outputs, { name: newName.value.trim() }]);
      focusKey('logic-out-name');
    }
    const detect = () => {
      const names = detectOutputs(area.value).filter(n => !outputs.some(o => o.name === n));
      if (!names.length) { toast('No new outputs found'); return; }
      saveOutputs(b, [...outputs, ...names.map(name => ({ name }))]);
      toast(`Added ${names.join(', ')}`);
    };
    return [
      el('div', { class: 'dt-sect' }, area, el('div', { class: 'dt-dim dt-hint' }, SCRIPT_HINT)),
      el('div', { class: 'dt-sect' },
        el('h4', {}, 'Outputs', el('span', { class: 'count' }, String(outputs.length)),
          el('button', { type: 'button', class: 'mini-btn ml', title: 'Add the keys of the last return { … } in the script', onclick: detect }, 'Detect')),
        outputs.length ? el('div', { class: 'logic-outs' }, outputs.map((o, i) => el('span', { class: 'logic-out' }, el('span', { class: 'vn' }, o.name),
          iconButton('x', `Remove output ${o.name}`, () => saveOutputs(b, outputs.filter((_, j) => j !== i)))))) : dim('No outputs yet. Name the keys your script returns.'),
        el('div', { class: 'out-edit' }, newName, el('button', { type: 'button', class: 'mini-btn', onclick: addOutput }, '＋ Add output')),
        error),
    ];
  }

  function consoleTab(id, result) {
    const rows = logicConsole(result);
    if (!rows.length) return [dim(result && done(result) ? 'The script logged nothing.' : 'Not run yet.')];
    return [el('div', { class: 'console-list dt-console', role: 'log', 'aria-label': 'Script console' },
      rows.map(({ level, text }) => el('div', { class: `console-row ${level}` }, el('span', { class: 'console-level' }, level), el('pre', {}, text))))];
  }

  // ---------- Inputs / Outputs ----------
  function ioTab(id, entry, result) {
    const b = blockOf(id);
    const vars = varInfo(id);
    const ins = (entry?.uses || []).map(({ name }) => {
      const v = vars.get(name);
      if (!v.from) {
        return el('tr', { class: 'miss' }, el('td', {}, el('span', { class: 'vn' }, name)), el('td', { class: 'val-cell' }, v.conflict ? 'conflict' : 'no value'),
          el('td', { class: 'src' }, v.conflict ? 'more than one source' : 'no source'));
      }
      return el('tr', {},
        el('td', {}, el('span', { class: 'vn' }, name), v.secret ? el('span', { class: 'lock', title: 'Sensitive value, hidden' }, icon('lock')) : null),
        el('td', { class: 'val-cell' }, v.value === undefined ? el('span', { class: 'dt-dim' }, 'not yet') : valueCell(v.value, { key: `in:${name}`, secret: v.secret })),
        el('td', { class: 'src' }, v.from === 'env' ? 'from environment' : ['from ', link(v.from)]));
    });
    const outputs = b.outputs || [];
    const rows = outputs.map((o, i) => (editing?.index === i ? editRow(b) : outRow(b, o, i, result)));
    if (editing?.index === -1) rows.push(editRow(b));
    const add = el('button', { type: 'button', class: 'mini-btn ml', disabled: Boolean(editing), onclick: () => { editing = { index: -1, name: '', path: isLogic(b) ? undefined : 'body.', error: null }; paint(); focusKey('out-name'); } }, '＋ Add output');
    return [
      sect('Inputs', ins.length, ins.length ? el('table', { class: 'dt-iot' }, ins) : dim('This block uses no variables.')),
      el('div', { class: 'dt-sect' }, el('h4', {}, 'Outputs', el('span', { class: 'count' }, String(outputs.length)), add),
        rows.length ? el('table', { class: 'dt-iot' }, rows) : dim(isLogic(b) ? 'No outputs yet. Add one in the Script tab.' : 'No outputs yet. In the Response tab, hover a line and click ＋ Output.')),
    ];
  }

  function outRow(b, o, i, result) {
    const to = c.flow.blocks.filter(x => c.analysis.get(x.id)?.uses.some(u => u.name === o.name && u.from === b.id)).map(x => x.id);
    let value;
    if (result?.state === 'ok' && has(result.outputs, o.name)) value = valueCell(toText(result.outputs[o.name]), { key: `out:${o.name}`, secret: isSensitiveName(o.name) });
    // An output added or changed after the run has no value until the next run.
    else if (result?.state === 'ok' && c.run?.snapshot?.flow?.blocks.find(x => x.id === b.id)?.outputs?.some(x => x.name === o.name && x.path === o.path)) {
      value = el('span', { class: 'warn' }, 'not found');
    }
    else value = el('span', { class: 'dt-dim' }, 'not yet');
    return el('tr', {},
      el('td', {}, el('span', { class: 'vn' }, o.name),
        el('span', { class: 'row-acts' },
          iconButton('edit', `Edit output ${o.name}`, () => { editing = { index: i, name: o.name, path: o.path, error: null }; paint(); focusKey('out-name'); }, { disabled: Boolean(editing) }),
          iconButton('trash', `Remove output ${o.name}`, () => saveOutputs(b, (b.outputs || []).filter((_, j) => j !== i)))),
        o.path != null ? el('div', { class: 'path', title: o.path }, o.path) : null),
      el('td', { class: 'val-cell' }, value),
      el('td', { class: 'src' }, to.length ? ['to ', ...links(to)] : 'to nothing yet'));
  }

  function editRow(b) {
    const save = () => {
      const outputs = [...(b.outputs || [])];
      const logic = isLogic(b);
      const error = logic ? outputNameError(editing.name, outputs, editing.index) : outputError(editing.name, editing.path, outputs, editing.index);
      if (error) { editing.error = error; paint(); return; }
      const next = logic ? { name: editing.name.trim() } : { name: editing.name.trim(), path: editing.path.trim() };
      if (editing.index === -1) outputs.push(next); else outputs[editing.index] = next;
      editing = null;
      saveOutputs(b, outputs);
    };
    const cancel = () => { editing = null; paint(); };
    const keys = e => {
      if (e.key === 'Enter') { e.preventDefault(); save(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); }
    };
    const input = (field, label) => el('input', { type: 'text', value: editing[field], 'aria-label': label, placeholder: label, spellcheck: 'false', dataset: { key: `out-${field}` },
      oninput: e => { editing[field] = e.target.value; }, onkeydown: keys });
    return el('tr', { class: 'editing' }, el('td', { colspan: '3' },
      el('div', { class: 'out-edit' }, input('name', 'Name'), isLogic(b) ? null : input('path', 'Path, e.g. body.data.token'),
        el('button', { type: 'button', class: 'mini-btn', onclick: save }, 'Save'), el('button', { type: 'button', class: 'mini-btn', onclick: cancel }, 'Cancel')),
      editing.error ? el('div', { class: 'out-error', role: 'alert' }, editing.error) : null));
  }

  function saveOutputs(b, outputs) {
    Promise.resolve(onChange({ blocks: c.flow.blocks.map(x => (x.id === b.id ? { ...x, outputs } : x)) }))
      .then(res => { if (res?.ok === false) toast(res.error ? `Could not save: ${res.error}` : 'Could not save the output'); });
    paint();
  }

  // ---------- Response ----------
  function responseTab(id, result) {
    const b = blockOf(id);
    const r = result.response;
    const parts = [];
    const skipped = c.flow.edges.filter(e => e.from === id && c.run?.blocks?.[e.to]?.state === 'skipped').map(e => e.to);
    if (outdatedOf(id)) parts.push(note('warn', OUTDATED));
    else if (result.state === 'failed' && skipped.length) parts.push(note('err', 'Skipped because of this error: ', ...links([...new Set(skipped)])));
    else if (result.state === 'failed' && result.errorKind === 'truncated') parts.push(note('err', result.error));
    else if (result.mock) parts.push(note('mock', 'Answered by a mock; the server was not called.'));
    if (!r) return [...parts, banner('bad', result.error || 'No response')];
    if (r.dropped) return [...parts, banner('skip', 'Response body not kept (too large to store)')];
    if (!r.bodyText) return [...parts, dim('Empty body.')];
    const value = parseJson(r.bodyText);
    const hits = el('span', { class: 'hits', 'aria-live': 'polite' });
    const find = el('input', { type: 'search', placeholder: 'Filter', value: q, 'aria-label': 'Filter response by key or value', dataset: { key: 'filter' },
      oninput: e => { q = e.target.value; applyFilter(); } });
    const fold = value && !raw ? el('button', { type: 'button', class: 'mini-btn sq' }) : null;
    const seg = value ? el('span', { class: 'dt-seg', role: 'group', 'aria-label': 'Body view' },
      ...[['json', 'JSON'], ['raw', 'Raw']].map(([m, label]) => el('button', { type: 'button', 'aria-pressed': String(raw === (m === 'raw')), dataset: { key: `seg-${m}` }, onclick: () => { raw = m === 'raw'; paint(); } }, label))) : null;
    const tools = el('div', { class: 'dt-tools' },
      el('label', { class: 'find' }, el('span', { 'aria-hidden': 'true' }, '⌕'), find, hits), fold,
      el('button', { type: 'button', class: 'mini-btn sq', title: 'Copy body', 'aria-label': 'Copy body', onclick: async () => {
        try { await navigator.clipboard.writeText(r.bodyText); toast('Copied'); } catch { toast('Copy failed'); }
      } }, icon('copy')), seg);
    const box = el('div', { class: 'dt-json', 'aria-label': 'Response body' });
    parts.push(tools);
    if (r.bodyTruncated) parts.push(dim('Showing the first 2 MB.'));
    parts.push(box);
    function applyFilter() {
      const rows = [...box.querySelectorAll(value && !raw ? '.jrow' : '.rl')];
      const needle = q.trim().toLowerCase();
      let n = 0;
      for (const row of rows) {
        const hit = needle && (row.querySelector('.jc') ?? row).textContent.toLowerCase().includes(needle);
        if (hit) n++;
        row.classList.toggle('match', Boolean(hit));
        row.classList.toggle('dim', Boolean(needle) && !hit);
      }
      hits.textContent = needle ? `${n} line${n === 1 ? '' : 's'}` : '';
    }
    if (value && !raw) {
      renderJsonView(box, value, {
        toggleButton: fold,
        highlights: outputHighlights(value, b.outputs),
        onAddOutput: path => {
          const out = newOutputFor(path, b.outputs);
          saveOutputs(b, [...(b.outputs || []), out]);
          toast(`Added output ${out.name}`);
        },
      });
      new MutationObserver(applyFilter).observe(box, { childList: true }); // folding redraws the rows
    } else {
      const text = value ? JSON.stringify(value, null, 2) : r.bodyText;
      box.append(el('pre', { class: 'raw' }, text.split('\n').map(line => el('span', { class: 'rl' }, line, '\n'))));
    }
    applyFilter();
    return parts;
  }

  // ---------- Request and Headers ----------
  function requestTab(id, entry, result) {
    const request = entry.request;
    const vars = varInfo(id);
    const url = String(request.url ?? '');
    const query = url.includes('?') ? url.slice(url.indexOf('?') + 1).split('&').filter(Boolean).map(p => {
      const at = p.indexOf('=');
      return at === -1 ? [p, ''] : [p.slice(0, at), p.slice(at + 1)];
    }) : [];
    const bodyOf = request.body || { mode: 'none' };
    let bodyNode = dim('No body.');
    if ((bodyOf.mode === 'json' || bodyOf.mode === 'text') && bodyOf.raw) bodyNode = el('div', { class: 'code' }, chipify(bodyOf.raw, vars));
    else if (bodyOf.mode === 'urlencoded' || bodyOf.mode === 'formdata') {
      const fields = (bodyOf.fields || []).filter(f => f.enabled && f.key);
      if (fields.length) bodyNode = el('table', { class: 'rq' }, fields.map(f => el('tr', {}, el('td', {}, chipify(f.key, vars)), el('td', {}, chipify(f.value, vars)))));
    }
    const crumbs = pathOf(c.ws, request.id).join(' › ');
    return [
      outdatedOf(id) ? note('warn', OUTDATED_REQUEST) : null,
      result?.mock ? note('mock', 'Not sent: answered by the mock.') : null,
      sect('URL', null, el('div', { class: 'urlbox' }, el('span', { class: `m ${request.method}` }, request.method), ' ', chipify(url, vars))),
      query.length ? sect('Query', query.length, el('table', { class: 'rq' }, query.map(([k, v]) => el('tr', {}, el('td', {}, chipify(k, vars)), el('td', {}, chipify(v, vars)))))) : null,
      sect('Body', null, bodyNode),
      el('div', { class: 'dt-sect' }, el('div', { class: 'dt-dim' }, 'Headers are in the Headers tab · ',
        el('button', { type: 'button', class: 'link', disabled: !onOpenRequest, title: crumbs, onclick: () => onOpenRequest?.(request.id) }, `${crumbs} ↗ open to edit`))),
    ].filter(Boolean);
  }

  function headersTab(id, entry, result) {
    const vars = varInfo(id);
    const reqHeaders = (entry?.request?.headers || []).filter(h => h.enabled && h.key);
    const resHeaders = result?.response?.headers;
    const reqRows = reqHeaders.map(h => {
      if (!isSensitiveHeader(h.key)) return el('tr', {}, el('td', {}, h.key), el('td', {}, chipify(h.value, vars)));
      const scheme = /^(\w+)\s/.exec(h.value)?.[0] ?? '';
      return el('tr', {}, el('td', {}, h.key), el('td', {}, valueCell(h.value, { key: `rqh:${h.key}`, secret: true, prefix: scheme, revealAs: () => el('span', {}, chipify(h.value, vars, true)) })));
    });
    return [
      outdatedOf(id) ? note('warn', OUTDATED_REQUEST) : null,
      sect('Request headers', reqRows.length, reqRows.length ? el('table', { class: 'rq' }, reqRows) : dim('No request headers.')),
      sect('Response headers', resHeaders?.length ?? 0, resHeaders ? el('table', { class: 'rq' }, resHeaders.map(([k, v]) => el('tr', {}, el('td', {}, k),
        el('td', {}, valueCell(String(v), { key: `rsh:${k}`, secret: isSensitiveHeader(k) }))))) : dim('No response yet.')),
    ];
  }

  // ---------- overview ----------
  function overview() {
    const { run, flow } = c;
    const results = run?.blocks || {};
    const count = s => flow.blocks.filter(b => results[b.id]?.state === s).length;
    const mocks = flow.blocks.filter(b => results[b.id]?.state === 'ok' && results[b.id].mock).length;
    const when = run?.startedAt ? new Date(run.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
    const meta = !run ? ['Not run yet'] : [
      run.status === 'running' ? 'Running…' : run.totalMs != null ? ms(run.totalMs) : '—',
      el('span', { class: 'ok' }, `✓ ${count('ok')}`), el('span', { class: 'bad' }, `✕ ${count('failed')}`), `⊘ ${count('skipped')}`,
      count('missing') ? el('span', { class: 'warn' }, `! ${count('missing')}`) : null, el('span', { class: 'mk' }, `${mocks} mock`),
    ].filter(Boolean);
    head.replaceChildren(el('div', { class: 'dt-top' }, el('h3', { class: 'dt-name' }, 'Last run'), when ? el('span', { class: 'when' }, when) : null, acts()),
      el('div', { class: 'dt-meta' }, meta.flatMap((p, i) => (i ? [el('span', { class: 'sep', 'aria-hidden': 'true' }, '·'), p] : [p]))));
    tabsEl.hidden = true;
    tabsEl.replaceChildren();
    const ends = flow.blocks.map(b => results[b.id]?.endMs).filter(n => n != null);
    const total = run?.totalMs || Math.max(1, ...ends);
    const order = [...flow.blocks].sort((a, b) => (results[a.id]?.startMs ?? Infinity) - (results[b.id]?.startMs ?? Infinity));
    const rows = order.map(b => {
      const r = results[b.id], entry = c.analysis.get(b.id);
      const cls = entry?.deleted && !done(r) ? 'bad' : CLASS[r?.state] ?? (entry?.missing.length || entry?.conflicts.length ? 'warn' : 'idle');
      const timed = r?.startMs != null && r?.endMs != null;
      const bar = timed
        ? el('i', { class: r.state === 'failed' ? 'failed' : r.mock ? 'mock' : 'ok', style: `left:${(r.startMs / total) * 100}%;width:${((r.endMs - r.startMs) / total) * 100}%` })
        : el('em', {}, cls === 'warn' ? 'not sent: missing variable' : cls === 'bad' && !r ? 'request deleted' : (TEXT[r?.state ?? 'idle'] ?? '').toLowerCase());
      return el('button', { type: 'button', class: 'wfr', onclick: () => onGo(b.id) },
        el('span', { class: `nm st s-${cls}` }, el('span', { class: 'ico', 'aria-hidden': 'true' }, ICON[cls] ?? ''), el('span', { class: 'wfn', title: nameOf(b.id) }, nameOf(b.id))),
        el('span', { class: 'bar' }, bar), el('span', { class: 'd' }, timed ? ms(r.endMs - r.startMs) : ''));
    });
    const issues = flow.blocks.flatMap(b => {
      const r = results[b.id], entry = c.analysis.get(b.id), name = el('b', {}, nameOf(b.id));
      const issue = (cls, ...text) => el('button', { type: 'button', class: 'issue', onclick: () => onGo(b.id) }, status(cls, ''), el('span', {}, name, ...text));
      if (r?.state === 'failed') return [issue('bad', r.errorKind === 'http' && r.response ? ` returned ${r.response.status}` : ` failed: ${r.error || (r.logic ? 'script error' : 'no response')}`)];
      if (entry?.deleted) return [issue('bad', ' uses a deleted request')];
      if (r?.state === 'skipped') return [issue('skip', ' was skipped because an earlier block failed')];
      const missing = [...(entry?.missing || []), ...(entry?.conflicts || [])];
      if (r?.state === 'missing' || missing.length) return [issue('warn', missing.length ? ` is missing {{${missing.join('}}, {{')}}}` : ` was not sent: ${r.error}`)];
      return [];
    });
    return [
      el('div', { class: 'dt-sect' }, el('h4', {}, 'Timeline')),
      el('div', { class: 'wf' }, el('div', { class: 'axis', 'aria-hidden': 'true' }, el('span'), el('span', { class: 'ticks' }, el('span', {}, '0'), el('span', {}, String(Math.round(total / 2))), el('span', {}, ms(total))), el('span')), rows),
      issues.length ? sect('Needs attention', null, issues) : null,
    ].filter(Boolean);
  }

  // ---------- painting ----------
  function focusKey(key) {
    root.querySelector(`[data-key="${key}"]`)?.focus();
  }

  // Rebuilds the column, keeping focus, the caret and the scroll position.
  function paint() {
    if (!c) return;
    const active = root.contains(document.activeElement) ? document.activeElement : null;
    const key = active?.dataset?.key;
    const caret = active && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
    const where = `${c.id}|${tab}`;
    const scroll = where === painted ? body.scrollTop : 0;
    if (!c.id) body.replaceChildren(...overview());
    else {
      const entry = c.analysis.get(c.id), result = c.run?.blocks?.[c.id];
      tab = tabs[kindOf(c.id)];
      blockHead(c.id, entry, result);
      drawTabs(c.id, entry, result);
      // A logic block's Script tab is for editing, so it never hides behind the "not run" banner.
      const why = done(result) || tab === 'script' ? null : reason(c.id, entry, result);
      const list = tabList(c.id);
      tab = tabs[kindOf(c.id)];
      if (!list.some(([t]) => t === tab)) tab = list[0][0];
      let content = [];
      if (tab === 'script') content = scriptTab(c.id);
      else if (tab === 'console') content = consoleTab(c.id, result);
      else if (tab === 'io') content = ioTab(c.id, entry, result);
      else if (tab === 'response') content = why ? [] : responseTab(c.id, result);
      else if (entry?.request) content = tab === 'request' ? requestTab(c.id, entry, result) : headersTab(c.id, entry, result);
      body.replaceChildren(...[why, ...content].filter(Boolean));
    }
    painted = where;
    body.scrollTop = scroll;
    if (key) {
      const next = root.querySelector(`[data-key="${key}"]`);
      next?.focus({ preventScroll: true });
      if (caret && next?.setSelectionRange) try { next.setSelectionRange(...caret); } catch { /* not a text field */ }
    }
  }

  function close() {
    max = false;
    root.classList.remove('max');
    onClose();
  }

  root.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (e.target.dataset?.key === 'filter' && q) { q = ''; paint(); return; }
      e.preventDefault();
      close();
      return;
    }
    const t = e.target.closest?.('[role="tab"]');
    if (t && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault();
      const list = c?.id ? tabList(c.id) : TABS;
      const i = list.findIndex(([id]) => id === t.dataset.tab);
      setTab(list[(i + (e.key === 'ArrowRight' ? 1 : list.length - 1)) % list.length][0]);
      focusKey(`tab-${tab}`);
    }
  });

  function render(ws, flow, run, analysis, selectedId) {
    const id = flow.blocks.some(b => b.id === selectedId) ? selectedId : null;
    if (id !== shownBlock) {
      if (draft && c) flushScript();
      shownBlock = id;
      editing = null;
      revealed.clear();
      expanded.clear();
    }
    c = { ws, flow, run, analysis, id };
    applyWidth();
    // Heartbeats and other blocks' updates leave the Response tab alone, so its folds survive a run.
    const next = [ws, flow, id, id && tab === 'response' ? run?.blocks?.[id] : run?.blocks, run?.status, run?.totalMs, run?.snapshot];
    if (sig && next.every((v, i) => v === sig[i])) return;
    sig = next;
    paint();
  }

  return {
    render,
    element: root,
    // Opens a tab of the selected block's kind (e.g. 'script' right after adding a Logic block).
    openTab(t) {
      if (LOGIC_TABS.some(([id]) => id === t)) { tabs.logic = t; store?.set('flowLogicTab', t); }
      else if (TABS.some(([id]) => id === t)) { tabs.request = t; store?.set('flowTab', t); }
      sig = null;
      if (c) paint();
    },
    destroy() { flushScript(); sizeWatch.disconnect(); root.remove(); },
  };
}
