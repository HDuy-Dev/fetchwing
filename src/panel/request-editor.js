// Request editor: method, URL, Send, and Params / Headers / Body tabs.

import { el, debounce, METHODS } from './ui.js';

const BODY_MODES = [['none', 'None'], ['json', 'JSON'], ['text', 'Text'], ['urlencoded', 'Form URL-encoded'], ['formdata', 'Form data']];

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

// opts: { onChange(patch), onSend(), missingFor(url): string[], crumbs: string[] }
export function createRequestEditor(container, request, opts) {
  const draft = structuredClone({ method: request.method, url: request.url, headers: request.headers, body: request.body });
  const save = debounce(() => opts.onChange(structuredClone(draft)), 300);
  let tab = 'params';

  const methodSel = el('select', { 'aria-label': 'Method', class: `m-${draft.method}` },
    METHODS.map(m => el('option', { value: m, selected: m === draft.method }, m)));
  const urlInput = el('input', { type: 'text', value: draft.url, placeholder: 'https://api.example.com/path or {{base}}/path', 'aria-label': 'URL', spellcheck: 'false' });
  const sendBtn = el('button', { class: 'primary', type: 'button', title: 'Send (Ctrl/Cmd+Enter)' }, 'Send');
  const missingEl = el('div', { class: 'missing', role: 'status' });
  const tabsEl = el('div', { class: 'tabs', role: 'tablist' });
  const tabBody = el('div', { class: 'tab-body' });

  const updateMissing = () => {
    const missing = opts.missingFor(draft.url);
    missingEl.textContent = missing.length ? `Unknown variables: ${missing.map(m => `{{${m}}}`).join(', ')}` : '';
  };

  methodSel.addEventListener('change', () => {
    draft.method = methodSel.value;
    methodSel.className = `m-${draft.method}`;
    save();
  });
  urlInput.addEventListener('input', () => {
    draft.url = urlInput.value;
    updateMissing();
    if (tab === 'params') renderTab();
    save();
  });
  sendBtn.addEventListener('click', () => { save.flush(); opts.onSend(); });
  container.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      save.flush();
      opts.onSend();
    }
  });

  function kvRows(rows, { onEdit, withEnabled }) {
    const wrap = el('div', { class: 'rows' });
    const draw = () => {
      wrap.textContent = '';
      rows.forEach((row, i) => {
        wrap.append(el('div', { class: 'row' },
          withEnabled ? el('input', { type: 'checkbox', checked: row.enabled !== false, 'aria-label': 'Enabled', onchange: e => { row.enabled = e.target.checked; onEdit(false); } }) : null,
          el('input', { type: 'text', value: row.key, placeholder: 'Key', 'aria-label': 'Key', oninput: e => { row.key = e.target.value; onEdit(false); } }),
          el('input', { type: 'text', value: row.value, placeholder: 'Value', 'aria-label': 'Value', oninput: e => { row.value = e.target.value; onEdit(false); } }),
          el('button', { type: 'button', class: 'ghost x', title: 'Remove', 'aria-label': 'Remove row', onclick: () => { rows.splice(i, 1); onEdit(true); draw(); } }, '✕')));
      });
      wrap.append(el('div', {}, el('button', {
        type: 'button', class: 'ghost',
        onclick: () => { rows.push(withEnabled ? { key: '', value: '', enabled: true } : { key: '', value: '' }); onEdit(true); draw(); wrap.querySelectorAll('input[type=text]')[rows.length * 2 - 2]?.focus(); },
      }, '+ Add')));
    };
    draw();
    return wrap;
  }

  function renderTab() {
    tabBody.textContent = '';
    if (tab === 'params') {
      const { base, rows } = splitUrl(draft.url);
      tabBody.append(kvRows(rows, {
        onEdit: () => {
          draft.url = joinUrl(base, rows);
          urlInput.value = draft.url;
          updateMissing();
          save();
        },
      }));
    } else if (tab === 'headers') {
      tabBody.append(kvRows(draft.headers, { withEnabled: true, onEdit: () => save() }));
    } else {
      const modes = el('div', { class: 'body-modes', role: 'radiogroup', 'aria-label': 'Body type' },
        BODY_MODES.map(([value, label]) => el('label', {},
          el('input', { type: 'radio', name: 'bodymode', value, checked: draft.body.mode === value, onchange: () => { draft.body.mode = value; save(); renderTab(); } }),
          label)));
      tabBody.append(modes);
      if (draft.body.mode === 'json' || draft.body.mode === 'text') {
        const area = el('textarea', { class: 'code-editor', spellcheck: 'false', 'aria-label': 'Body', value: draft.body.raw });
        area.value = draft.body.raw;
        area.addEventListener('input', () => { draft.body.raw = area.value; save(); });
        tabBody.append(area);
        if (draft.body.mode === 'json') {
          const msg = el('span', { class: 'hint' });
          tabBody.append(el('div', { class: 'row' }, el('button', {
            type: 'button',
            onclick: () => {
              try {
                area.value = JSON.stringify(JSON.parse(area.value), null, 2);
                draft.body.raw = area.value;
                msg.textContent = '';
                save();
              } catch (err) {
                msg.textContent = `Invalid JSON: ${err.message}`;
              }
            },
          }, 'Format JSON'), msg));
        }
      } else if (draft.body.mode === 'urlencoded' || draft.body.mode === 'formdata') {
        tabBody.append(kvRows(draft.body.fields, { withEnabled: true, onEdit: () => save() }));
        if (draft.body.mode === 'formdata') tabBody.append(el('div', { class: 'hint' }, 'Text fields only. File upload is not supported yet.'));
      }
    }
  }

  function drawTabs() {
    tabsEl.textContent = '';
    for (const [id, label] of [['params', 'Params'], ['headers', `Headers${draft.headers.length ? ` (${draft.headers.length})` : ''}`], ['body', 'Body']]) {
      tabsEl.append(el('button', {
        type: 'button', role: 'tab', class: 'tab', 'aria-selected': String(tab === id),
        onclick: () => { tab = id; drawTabs(); renderTab(); },
      }, label));
    }
  }

  container.textContent = '';
  container.append(
    el('div', { class: 'crumbs' }, opts.crumbs.join(' / ')),
    el('div', { class: 'urlbar' }, methodSel, urlInput, sendBtn),
    missingEl,
    tabsEl,
    tabBody,
  );
  updateMissing();
  drawTabs();
  renderTab();

  return {
    flush: () => save.flush(),
    getDraft: () => draft,
    setSending(busy) {
      sendBtn.disabled = busy;
      sendBtn.textContent = busy ? 'Sending…' : 'Send';
    },
    refreshMissing: updateMissing,
  };
}
