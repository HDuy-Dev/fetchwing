// Request editor: method + URL + Send, missing-variable warning, Params / Headers / Body.

import { el, icon, debounce, METHODS } from './ui.js';
import { BODY_MODES, bodyBadge, bodylessWarning, blankRowLabels } from '../lib/body-view.js';

const BODY_HINTS = {
  urlencoded: 'Sent as key=value&key2=value2.',
  formdata: "Text fields only. File upload isn't supported yet.",
};
const RAW_PLACEHOLDERS = { json: '{ "name": "value" }', text: 'Enter the request body' };

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
  const bodyWarning = el('div', { class: 'var-warning body-warning', role: 'status' });

  const updateBodyWarning = () => {
    const text = bodylessWarning(draft.method, draft.body.mode);
    bodyWarning.textContent = '';
    bodyWarning.hidden = !text;
    if (text) bodyWarning.append(icon('warn'), text);
  };

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
    updateBodyWarning();
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
  function kvTable(rows, { onEdit, withEnabled, kind = 'field' }) {
    const blank = blankRowLabels(kind);
    const table = el('table', { class: 'kv' });
    const draw = focusIndex => {
      table.textContent = '';
      table.append(el('thead', {}, el('tr', {},
        el('th', {}, withEnabled ? el('span', { class: 'sr-only' }, 'On') : null), el('th', {}, 'Key'), el('th', {}, 'Value'), el('th', {}))));
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
        const name = field => (isBlank ? blank[field] : field === 'key' ? 'Key' : 'Value');
        const input = field => el('input', {
          type: 'text', value: row?.[field] ?? '', placeholder: name(field), 'aria-label': name(field), spellcheck: 'false',
          dataset: { row: String(i), field },
          oninput: e => commit(field, e.target.value),
        });
        body.append(el('tr', { class: isBlank ? 'blank' : null },
          el('td', { class: 'cb' }, isBlank ? icon('plus') : withEnabled ? el('input', {
            type: 'checkbox', class: 'cbx', checked: row.enabled !== false, 'aria-label': 'Enabled',
            onchange: e => { row.enabled = e.target.checked; onEdit(); },
          }) : null),
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
      tabBody.append(kvTable(draft.headers, { withEnabled: true, kind: 'header', onEdit: () => { drawTabs(); touch(); } }));
    } else {
      renderBody();
    }
  }

  function renderBody() {
    const { mode } = draft.body;
    tabBody.append(el('div', { class: 'body-modes', role: 'radiogroup', 'aria-label': 'Body type' },
      BODY_MODES.map(([value, label]) => el('label', {},
        el('input', {
          type: 'radio', name: 'bodymode', value, checked: mode === value,
          onchange: () => {
            draft.body.mode = value;
            touch();
            drawTabs();
            renderTab();
            // The redraw replaced the radio; keep the keyboard on it.
            tabBody.querySelector(`input[name="bodymode"][value="${value}"]`)?.focus();
          },
        }),
        el('span', {}, label)))), bodyWarning);
    updateBodyWarning();

    if (mode === 'none') {
      tabBody.append(el('div', { class: 'hint body-empty' }, 'This request has no body. Pick a type above to add one.'));
    } else if (mode === 'json' || mode === 'text') {
      const area = el('textarea', { class: 'code-area', spellcheck: 'false', 'aria-label': 'Body', placeholder: RAW_PLACEHOLDERS[mode] });
      area.value = draft.body.raw;
      area.addEventListener('input', () => { draft.body.raw = area.value; touch(); });
      tabBody.append(area);
      if (mode === 'json') {
        const msg = el('span', { class: 'hint', role: 'status' });
        tabBody.append(el('div', { class: 'body-actions' }, el('button', {
          type: 'button', class: 'btn btn-small',
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
        }, icon('pretty'), 'Format JSON'), msg));
      }
    } else {
      tabBody.append(kvTable(draft.body.fields, { withEnabled: true, onEdit: () => touch() }),
        el('div', { class: 'hint body-note' }, BODY_HINTS[mode]));
    }
  }

  function drawTabs() {
    tabsEl.textContent = '';
    const params = splitUrl(draft.url).rows.length;
    const headers = draft.headers.filter(h => h.enabled !== false && h.key).length;
    const badge = bodyBadge(draft.body.mode);
    for (const [id, label, count] of [['params', 'Params', params], ['headers', 'Headers', headers], ['body', 'Body', 0]]) {
      tabsEl.append(el('button', {
        type: 'button', role: 'tab', class: 'subtab', 'aria-selected': String(tab === id), dataset: { tab: id },
        onclick: () => { tab = id; drawTabs(); renderTab(); },
      }, label, count ? el('span', { class: 'count' }, String(count)) : null,
      id === 'body' && badge ? el('span', { class: 'count' }, badge) : null));
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
