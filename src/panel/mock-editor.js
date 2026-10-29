// Mock tab: on/off switch, status, headers, body and delay for one request.

import { el, debounce } from './ui.js';
import { ensureOrigin } from './permissions.js';
import { prettyBody } from './response-view.js';

const DROP_HEADERS = new Set(['content-length', 'content-encoding', 'transfer-encoding', 'connection', 'keep-alive', 'set-cookie', 'date']);

export function mockFromResponse(r) {
  return {
    status: r.status,
    headers: r.headers.filter(([k]) => !DROP_HEADERS.has(k.toLowerCase())).map(([key, value]) => ({ key, value })),
    body: prettyBody(r.bodyText).text,
  };
}

const send = msg => chrome.runtime.sendMessage(msg);
let current = null; // { id, refresh(item, state) }

export function renderMockEditor(pane, item, state) {
  // Rebuilding while the user types would lose the caret; only refresh the switch/notice.
  if (current?.id === item.id && pane.contains(document.activeElement)) {
    current.refresh(item, state);
    return;
  }
  pane.textContent = '';
  const draft = structuredClone({ status: item.mock.status, headers: item.mock.headers, body: item.mock.body, delayMs: item.mock.delayMs });
  const save = debounce(() => send({ type: 'mutate', mutation: { type: 'updateMock', id: item.id, patch: structuredClone(draft) } }), 300);

  const switchInput = el('input', { type: 'checkbox', role: 'switch', 'aria-label': 'Mock on' });
  const switchLabel = el('span');
  const errorEl = el('div', { class: 'missing', role: 'alert' });
  const notice = el('div', { class: 'hint' });

  const refresh = (it, st) => {
    switchInput.checked = it.mock.enabled;
    switchLabel.textContent = it.mock.enabled ? 'Mock is ON' : 'Mock is off';
    switchLabel.style.color = it.mock.enabled ? 'var(--mock)' : '';
    switchLabel.style.fontWeight = it.mock.enabled ? '600' : '';
    const sites = st.mockSites;
    notice.textContent = it.mock.enabled
      ? (sites.length
        ? `Pages on ${sites.join(', ')} get this response instead of the real API. Manage sites in Settings.`
        : 'No site is set up for mocking yet. Open your web app in this tab and turn the mock on again.')
      : 'When on, web pages calling this method and URL get this response instead of the real API.';
  };

  switchInput.addEventListener('change', async () => {
    errorEl.textContent = '';
    const enable = switchInput.checked;
    if (enable) {
      save.flush();
      const origin = state.inspectedOrigin;
      if (origin && /^https?:/.test(origin) && !state.mockSites.includes(origin)) {
        const access = await ensureOrigin(origin);
        if (access !== 'granted') {
          switchInput.checked = false;
          errorEl.textContent = access === 'pending'
            ? 'Allow access in the window that opened, then turn the mock on again.'
            : `Fetchwing needs permission to run on ${origin} to mock its requests.`;
          return;
        }
        await send({ type: 'addMockSite', origin });
      }
    }
    const res = await send({ type: 'mutate', mutation: { type: 'setMockEnabled', id: item.id, enabled: enable } });
    if (!res?.ok) {
      switchInput.checked = !enable;
      errorEl.textContent = res?.error ?? 'Could not change the mock.';
    }
  });

  const statusInput = el('input', { type: 'number', min: '100', max: '599', value: draft.status, 'aria-label': 'Status code', style: 'width:80px' });
  statusInput.addEventListener('input', () => {
    const n = Number(statusInput.value);
    if (Number.isInteger(n) && n >= 100 && n <= 599) { draft.status = n; save(); }
  });
  const delayInput = el('input', { type: 'number', min: '0', max: '60000', step: '100', value: draft.delayMs, 'aria-label': 'Delay in milliseconds', style: 'width:90px' });
  delayInput.addEventListener('input', () => {
    const n = Number(delayInput.value);
    if (Number.isFinite(n) && n >= 0) { draft.delayMs = Math.min(60000, Math.round(n)); save(); }
  });

  const headerRows = el('div', { class: 'rows' });
  const drawHeaders = () => {
    headerRows.textContent = '';
    draft.headers.forEach((h, i) => headerRows.append(el('div', { class: 'row' },
      el('input', { type: 'text', value: h.key, placeholder: 'Header', 'aria-label': 'Header name', oninput: e => { h.key = e.target.value; save(); } }),
      el('input', { type: 'text', value: h.value, placeholder: 'Value', 'aria-label': 'Header value', oninput: e => { h.value = e.target.value; save(); } }),
      el('button', { type: 'button', class: 'ghost x', 'aria-label': 'Remove header', onclick: () => { draft.headers.splice(i, 1); save(); drawHeaders(); } }, '✕'))));
    headerRows.append(el('div', {}, el('button', { type: 'button', class: 'ghost', onclick: () => { draft.headers.push({ key: '', value: '' }); save(); drawHeaders(); } }, '+ Add header')));
  };
  drawHeaders();

  const bodyArea = el('textarea', { class: 'code-editor', spellcheck: 'false', 'aria-label': 'Mock response body', placeholder: '{ "message": "mocked" }' });
  bodyArea.value = draft.body;
  bodyArea.addEventListener('input', () => { draft.body = bodyArea.value; save(); });
  const formatMsg = el('span', { class: 'hint' });

  pane.append(
    el('div', { class: 'row' }, el('label', { class: 'row' }, switchInput, switchLabel)),
    errorEl,
    notice,
    el('div', { class: 'row', style: 'margin-top:8px' },
      el('label', {}, 'Status ', statusInput),
      el('label', {}, 'Delay (ms) ', delayInput)),
    el('div', { class: 'hint', style: 'margin-top:8px' }, 'Headers'),
    headerRows,
    el('div', { class: 'hint', style: 'margin-top:8px' }, 'Body'),
    bodyArea,
    el('div', { class: 'row' }, el('button', {
      type: 'button',
      onclick: () => {
        try {
          bodyArea.value = JSON.stringify(JSON.parse(bodyArea.value), null, 2);
          draft.body = bodyArea.value;
          formatMsg.textContent = '';
          save();
        } catch (err) {
          formatMsg.textContent = `Invalid JSON: ${err.message}`;
        }
      },
    }, 'Format JSON'), formatMsg),
  );
  refresh(item, state);
  current = { id: item.id, refresh };
}
