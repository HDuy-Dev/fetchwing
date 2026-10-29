// Request editor: method + URL + Send, missing-variable warning, Params / Headers / Body.

import { el, icon, debounce, METHODS } from './ui.js';

const BODY_MODES = [['none', 'None'], ['json', 'JSON'], ['text', 'Text'], ['urlencoded', 'URL-encoded'], ['formdata', 'Form data']];

// Query string <-> rows, keeping the user's encoding as typed.
export function splitUrl(url) {
  const hashAt = url.indexOf('#');
  const noHash = hashAt === -1 ? url : url.slice(0, hashAt);
  const qAt = noHash.indexOf('?');
  if (qAt === -1) return { base: noHash, rows: [] };
  const rows = noHash.slice(qAt + 1).split('&').filter(Boolean).map(pair => {
    const at = pair.indexOf('=');
    return at === -1 ? { key: pair, value: '' } : { key: pair.slice(0, at), value: pair.slice(at + 1) };
  });
  return { base: noHash.slice(0, qAt), rows };
}

export function joinUrl(base, rows) {
  const query = rows.filter(r => r.key || r.value).map(r => (r.value === '' ? r.key : `${r.key}=${r.value}`)).join('&');
  return query ? `${base}?${query}` : base;
}

// opts: { onChange(patch), onSend(), onCancel(), onAddVar(name), missingFor(url): string[], onPendingChange() }
export function createRequestEditor(container, request, opts) {
  const draft = structuredClone({ method: request.method, url: request.url, headers: request.headers, body: request.body });
  const save = debounce(() => { opts.onChange(structuredClone(draft)); opts.onPendingChange?.(); }, 300);
  const touch = () => { save(); opts.onPendingChange?.(); };
  let tab = 'params';
  let busy = false;

  const methodSel = el('select', { 'aria-label': 'Method', class: `m ${draft.method}` },
    METHODS.map(m => el('option', { value: m, selected: m === draft.method }, m)));
  const urlInput = el('input', { type: 'text', value: draft.url, placeholder: 'https://api.example.com/path or {{base}}/path', 'aria-label': 'URL', spellcheck: 'false' });
  const sendBtn = el('button', { class: 'send', type: 'button', title: 'Send (⌘↵)' }, 'Send');
  const missingEl = el('div', { class: 'var-warning', role: 'status', hidden: true });
  const tabsEl = el('div', { class: 'subtabs', role: 'tablist' });
  const tabBody = el('div', { class: 'tab-body' });

  const updateMissing = () => {
    const missing = opts.missingFor(draft.url);
    missingEl.textContent = '';
    missingEl.hidden = !missing.length;
    if (!missing.length) return;
    missingEl.append(icon('warn'), el('span', {}, ...missing.flatMap((m, i) => [i ? ', ' : '', el('b', {}, m)]), ' undefined'),
      el('button', { type: 'button', class: 'ibtn', 'aria-label': `Add variable ${missing[0]}`, title: 'Add variable', onclick: () => opts.onAddVar(missing[0]) }, icon('plus')));
  };

  methodSel.addEventListener('change', () => {
    draft.method = methodSel.value;
    methodSel.className = `m ${draft.method}`;
    touch();
  });
  urlInput.addEventListener('input', () => {
    draft.url = urlInput.value;
    updateMissing();
    if (tab === 'params') { renderTab(); drawTabs(); }
    touch();
  });
  const fire = () => {
    if (busy) { opts.onCancel(); return; }
    save.flush();
    opts.onSend();
  };
  sendBtn.addEventListener('click', fire);
  container.onkeydown = e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); fire(); }
  };

  // rows: [{key, value, enabled?}]. Always ends with a blank row to type into.
  function kvTable(rows, { onEdit, withEnabled }) {
    const table = el('table', { class: 'kv' });
    const draw = focusIndex => {
      table.textContent = '';
      table.append(el('thead', {}, el('tr', {},
        withEnabled ? el('th', {}, el('span', { class: 'sr-only' }, 'On')) : null, el('th', {}, 'Key'), el('th', {}, 'Value'), el('th', {}))));
      const body = el('tbody');
      const all = [...rows, null];
      all.forEach((row, i) => {
        const isBlank = row === null;
        const commit = (field, value) => {
          if (isBlank) {
            rows.push(withEnabled ? { key: '', value: '', enabled: true } : { key: '', value: '' });
            rows[rows.length - 1][field] = value;
            onEdit();
            draw({ row: i, field });
            return;
          }
          row[field] = value;
          onEdit();
        };
        const input = field => el('input', {
          type: 'text', value: row?.[field] ?? '', placeholder: field === 'key' ? 'Key' : 'Value', 'aria-label': field === 'key' ? 'Key' : 'Value', spellcheck: 'false',
          dataset: { row: String(i), field },
          oninput: e => commit(field, e.target.value),
        });
        body.append(el('tr', {},
          withEnabled ? el('td', { class: 'cb' }, isBlank ? null : el('input', {
            type: 'checkbox', class: 'cbx', checked: row.enabled !== false, 'aria-label': 'Enabled',
            onchange: e => { row.enabled = e.target.checked; onEdit(); },
          })) : null,
          el('td', {}, input('key')),
          el('td', {}, input('value')),
          el('td', { class: 'act' }, isBlank ? null : el('button', {
            type: 'button', class: 'ibtn row-x', 'aria-label': 'Remove row', title: 'Remove',
            onclick: () => { rows.splice(i, 1); onEdit(); draw(); },
          }, icon('x')))));
      });
      table.append(body);
      if (focusIndex) {
        const target = table.querySelector(`input[data-row="${focusIndex.row}"][data-field="${focusIndex.field}"]`);
        target?.focus();
        target?.setSelectionRange(target.value.length, target.value.length);
      }
    };
    draw();
    return table;
  }

  function renderTab() {
    tabBody.textContent = '';
    if (tab === 'params') {
      const { base, rows } = splitUrl(draft.url);
      tabBody.append(kvTable(rows, {
        onEdit: () => {
          draft.url = joinUrl(base, rows);
          urlInput.value = draft.url;
          updateMissing();
          drawTabs();
          touch();
        },
      }));
    } else if (tab === 'headers') {
      tabBody.append(kvTable(draft.headers, { withEnabled: true, onEdit: () => { drawTabs(); touch(); } }));
    } else {
      tabBody.append(el('div', { class: 'body-modes', role: 'radiogroup', 'aria-label': 'Body type' },
        BODY_MODES.map(([value, label]) => el('label', {},
          el('input', { type: 'radio', name: 'bodymode', value, checked: draft.body.mode === value, onchange: () => { draft.body.mode = value; touch(); renderTab(); } }),
          label))));
      if (draft.body.mode === 'json' || draft.body.mode === 'text') {
        const area = el('textarea', { class: 'code-area', spellcheck: 'false', 'aria-label': 'Body' });
        area.value = draft.body.raw;
        area.addEventListener('input', () => { draft.body.raw = area.value; touch(); });
        tabBody.append(area);
        if (draft.body.mode === 'json') {
          const msg = el('span', { class: 'hint' });
          tabBody.append(el('div', { class: 'tool-icons', style: 'margin-top:4px' }, el('button', {
            type: 'button', class: 'ibtn', 'aria-label': 'Format JSON', title: 'Format JSON',
            onclick: () => {
              try {
                area.value = JSON.stringify(JSON.parse(area.value), null, 2);
                draft.body.raw = area.value;
                msg.textContent = '';
                touch();
              } catch (err) {
                msg.textContent = `Invalid JSON: ${err.message}`;
              }
            },
          }, icon('pretty')), msg));
        }
      } else if (draft.body.mode === 'urlencoded' || draft.body.mode === 'formdata') {
        tabBody.append(kvTable(draft.body.fields, { withEnabled: true, onEdit: () => touch() }));
        if (draft.body.mode === 'formdata') tabBody.append(el('div', { class: 'hint' }, 'Text fields only.'));
      }
    }
  }

  function drawTabs() {
    tabsEl.textContent = '';
    const params = splitUrl(draft.url).rows.length;
    const headers = draft.headers.filter(h => h.enabled !== false && h.key).length;
    const hasBody = draft.body.mode !== 'none';
    for (const [id, label, count] of [['params', 'Params', params], ['headers', 'Headers', headers], ['body', 'Body', 0]]) {
      tabsEl.append(el('button', {
        type: 'button', role: 'tab', class: 'subtab', 'aria-selected': String(tab === id), dataset: { tab: id },
        onclick: () => { tab = id; drawTabs(); renderTab(); },
      }, label, count ? el('span', { class: 'count' }, String(count)) : null,
      id === 'body' && hasBody ? el('span', { class: 'count' }, draft.body.mode) : null));
    }
  }

  container.textContent = '';
  container.append(
    el('div', { class: 'urlbar' }, el('div', { class: 'urlgroup' }, methodSel, urlInput), sendBtn),
    missingEl,
    tabsEl,
    tabBody,
  );
  updateMissing();
  drawTabs();
  renderTab();

  return {
    flush: () => { if (save.isPending()) save.flush(); },
    isPending: () => save.isPending(),
    getDraft: () => draft,
    setSending(on) {
      busy = on;
      sendBtn.className = on ? 'send busy' : 'send';
      sendBtn.textContent = '';
      if (on) sendBtn.append(el('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Cancel');
      else sendBtn.append('Send');
      sendBtn.title = on ? 'Cancel' : 'Send (⌘↵)';
    },
    refreshMissing: updateMissing,
  };
}
