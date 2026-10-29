// Response pane: status, time, size, Body (pretty JSON) and Headers.

import { el } from './ui.js';

const HIGHLIGHT_LIMIT = 300_000;

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

const escapeHtml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function highlightJson(pretty) {
  return escapeHtml(pretty).replace(
    /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (m, str, colon, lit, num) => {
      if (str) return colon ? `<span class="j-key">${str}</span>${colon}` : `<span class="j-str">${str}</span>`;
      if (lit) return `<span class="j-lit">${lit}</span>`;
      return `<span class="j-num">${num}</span>`;
    },
  );
}

export function prettyBody(text) {
  try {
    const value = JSON.parse(text);
    if (value !== null && typeof value === 'object') return { json: true, text: JSON.stringify(value, null, 2) };
  } catch {
    // not JSON
  }
  return { json: false, text };
}

// entry: undefined | { loading } | { error } | { response }
export function renderResponse(pane, entry, { onMockThis }) {
  pane.textContent = '';
  if (!entry) {
    pane.append(el('div', { class: 'hint' }, 'Press Send to see the response here.'));
    return;
  }
  if (entry.loading) {
    pane.append(el('div', { class: 'hint' }, 'Sending…'));
    return;
  }
  if (entry.error) {
    pane.append(el('div', { class: 'error-box', role: 'alert' }, entry.error));
    return;
  }
  const r = entry.response;
  let view = 'body';
  let raw = false;
  const body = el('div');
  const pretty = prettyBody(r.bodyText);

  const draw = () => {
    body.textContent = '';
    if (view === 'headers') {
      body.append(el('table', { class: 'headers' }, r.headers.map(([k, v]) => el('tr', {}, el('td', {}, k), el('td', {}, v)))));
      return;
    }
    const pre = el('pre', { class: 'body' });
    if (pretty.json && !raw && pretty.text.length < HIGHLIGHT_LIMIT) pre.innerHTML = highlightJson(pretty.text);
    else pre.textContent = raw ? r.bodyText : pretty.text;
    if (r.bodyTruncated) body.append(el('div', { class: 'hint' }, 'Large response: showing the first 2 MB.'));
    body.append(pre);
  };

  const tabs = el('div', { class: 'tabs', role: 'tablist' });
  const drawTabs = () => {
    tabs.textContent = '';
    for (const [id, label] of [['body', 'Body'], ['headers', `Headers (${r.headers.length})`]]) {
      tabs.append(el('button', { type: 'button', role: 'tab', class: 'tab', 'aria-selected': String(view === id), onclick: () => { view = id; drawTabs(); draw(); } }, label));
    }
    if (pretty.json) {
      tabs.append(el('label', { class: 'hint', style: 'margin-left:auto;display:flex;align-items:center;gap:4px' },
        el('input', { type: 'checkbox', checked: raw, onchange: e => { raw = e.target.checked; draw(); } }), 'Raw'));
    }
  };

  pane.append(
    el('div', { class: 'status-line' },
      el('span', { class: `pill s${String(r.status)[0]}` }, `${r.status} ${r.statusText || ''}`.trim()),
      el('span', { class: 'hint' }, `${Math.round(r.timeMs)} ms`),
      el('span', { class: 'hint' }, formatSize(r.sizeBytes)),
      el('span', { class: 'spacer' }),
      el('button', { type: 'button', title: 'Copy this response into the Mock tab', onclick: () => onMockThis(r) }, 'Mock this')),
    tabs,
    body,
  );
  drawTabs();
  draw();
}
