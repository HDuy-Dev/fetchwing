// Response pane: stats in the header, Body (foldable JSON / raw) and Headers.

import { el, icon, iconButton, toast } from './ui.js';
import { parseJson, renderJsonView } from './json-view.js';

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function prettyBody(text) {
  const value = parseJson(text);
  return value ? { json: true, text: JSON.stringify(value, null, 2), value } : { json: false, text };
}

const statusClass = s => (s < 300 ? 'ok' : s < 400 ? 'redirect' : 'err');
const formatTime = ms => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);

let ticker = null;

// entry: undefined | { loading, startedAt } | { error } | { response }
export function renderResponse(pane, stats, entry, { onMockThis, onRetry }) {
  clearInterval(ticker);
  pane.textContent = '';
  stats.textContent = '';
  if (!entry) {
    pane.append(el('div', { class: 'pane-hint' }, icon('retry'), el('span', {}, 'Send to see the response')));
    return;
  }
  if (entry.loading) {
    const time = el('b', {}, '0.0 s');
    const tick = () => { time.textContent = `${((Date.now() - entry.startedAt) / 1000).toFixed(1)} s`; };
    tick();
    ticker = setInterval(() => { if (!pane.isConnected) clearInterval(ticker); else tick(); }, 100);
    pane.append(el('div', { class: 'sending', role: 'status' }, el('span', { class: 'spinner', 'aria-hidden': 'true' }), time));
    return;
  }
  if (entry.error) {
    pane.append(el('div', { class: 'state-box err', role: 'alert' },
      el('div', { class: 'row' }, icon('alert'), el('h3', {}, entry.error),
        onRetry ? iconButton('retry', 'Retry', onRetry, { class: 'ibtn ml-auto' }) : null),
      entry.detail ? el('p', {}, entry.detail) : null));
    return;
  }

  const r = entry.response;
  stats.append(
    el('span', { class: `status ${statusClass(r.status)}` }, `${r.status} ${r.statusText || ''}`.trim()),
    el('span', { title: 'Time' }, el('b', {}, formatTime(r.timeMs))),
    el('span', { class: 'opt', title: 'Size' }, el('b', {}, formatSize(r.sizeBytes))));

  const pretty = prettyBody(r.bodyText);
  let view = 'body';
  let raw = !pretty.json;
  const content = el('div', { class: 'pane', style: 'min-height:0' });

  const segBtn = (id, label) => el('button', { type: 'button', 'aria-pressed': String(view === id), onclick: () => { view = id; draw(); } }, label);
  const tools = el('div', { class: 'resp-tools' });

  function draw() {
    tools.textContent = '';
    content.textContent = '';
    tools.append(el('div', { class: 'seg', role: 'group', 'aria-label': 'Section' }, segBtn('body', 'Body'), segBtn('headers', `Headers (${r.headers.length})`)));
    const icons = el('div', { class: 'tool-icons ml-auto' });
    tools.append(icons);
    if (view === 'headers') {
      content.append(el('div', { class: 'headers-table' }, el('table', {}, r.headers.map(([k, v]) => el('tr', {}, el('td', {}, k), el('td', {}, v))))));
    } else {
      const fold = pretty.json && !raw ? iconButton('collapse', 'Collapse all', null) : null;
      if (fold) icons.append(fold);
      if (pretty.json) {
        icons.append(
          iconButton('pretty', 'Pretty', () => { raw = false; draw(); }, { 'aria-pressed': String(!raw) }),
          iconButton('raw', 'Raw', () => { raw = true; draw(); }, { 'aria-pressed': String(raw) }));
      }
      if (r.bodyTruncated) content.append(el('div', { class: 'hint', style: 'padding:0 16px 4px' }, 'Showing the first 2 MB.'));
      if (pretty.json && !raw) {
        const box = el('div', { 'aria-label': 'Response body' });
        content.append(box);
        renderJsonView(box, pretty.value, { toggleButton: fold });
      } else {
        content.append(el('pre', { class: 'raw' }, raw ? r.bodyText : pretty.text));
      }
    }
    icons.append(
      iconButton('copy', 'Copy', async () => {
        const text = view === 'headers' ? r.headers.map(([k, v]) => `${k}: ${v}`).join('\n') : r.bodyText;
        try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Copy failed'); }
      }),
      iconButton('mock', 'Mock this response', () => onMockThis(r)));
  }

  pane.append(tools, content);
  draw();
}
