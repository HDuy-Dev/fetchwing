// Small DOM helpers and the icon set shared by the panel views.

const ICONS = {
  logo: '<path d="M4 15c4-1 7-4 9-9 1 4 0 8-3 11"/><path d="M10 17c3 0 6-1 10-4"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  mock: '<path d="M17 3l4 4-4 4"/><path d="M3 11V9a2 2 0 0 1 2-2h16"/><path d="M7 21l-4-4 4-4"/><path d="M21 13v2a2 2 0 0 1-2 2H3"/>',
  braces: '<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h1"/><path d="M16 3h1a2 2 0 0 1 2 2v5a2 2 0 0 0 2 2 2 2 0 0 0-2 2v5a2 2 0 0 1-2 2h-1"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  clipboard: '<rect x="8" y="3" width="8" height="4" rx="1"/><path d="M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>',
  import: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  pretty: '<path d="M8 4c-2 0-3 1-3 3v2c0 1.5-1 2.5-2 3 1 .5 2 1.5 2 3v2c0 2 1 3 3 3"/><path d="M16 4c2 0 3 1 3 3v2c0 1.5 1 2.5 2 3-1 .5-2 1.5-2 3v2c0 2-1 3-3 3"/>',
  raw: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  collapse: '<path d="m7 15 5-5 5 5"/><path d="M7 20h10M7 4h10"/>',
  expand: '<path d="m7 9 5 5 5-5"/><path d="M7 20h10M7 4h10"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  retry: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>',
  warn: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
};

export function icon(name, extraClass = '') {
  const span = document.createElement('span');
  span.innerHTML = `<svg class="i ${extraClass}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] ?? ''}</svg>`;
  return span.firstChild;
}

export function el(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style' && typeof v === 'string') node.setAttribute('style', v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in node && typeof v !== 'string') node[k] = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

// Icon-only button: always labelled for screen readers and tooltips.
export function iconButton(name, label, onClick, props = {}) {
  return el('button', { type: 'button', class: 'ibtn', 'aria-label': label, title: label, onclick: onClick, ...props }, icon(name));
}

let toastTimer;
export function toast(message, ms = 2600) {
  const t = document.getElementById('toast');
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

// Context menu. items: { label, icon?, action, danger?, confirm?, prefix? } | 'sep'
export function showMenu(x, y, items) {
  const menu = document.getElementById('menu');
  menu.textContent = '';
  const close = () => {
    menu.hidden = true;
    document.removeEventListener('mousedown', outside, true);
    document.removeEventListener('keydown', onKey, true);
  };
  const outside = e => { if (!menu.contains(e.target)) close(); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  for (const item of items) {
    if (item === 'sep') { menu.append(el('div', { class: 'sep' })); continue; }
    menu.append(el('button', {
      type: 'button', role: 'menuitem', class: item.danger ? 'danger' : '',
      onclick: () => {
        if (item.confirm) {
          menu.textContent = '';
          menu.append(
            el('div', { class: 'confirm' }, item.confirm),
            el('button', { type: 'button', class: 'danger', onclick: () => { close(); item.action(); } }, 'Delete'),
            el('button', { type: 'button', onclick: close }, 'Cancel'),
          );
          menu.querySelector('button')?.focus();
          return;
        }
        close();
        item.action();
      },
    }, item.icon ? icon(item.icon) : null, item.prefix ?? null, item.label));
  }
  menu.hidden = false;
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(x, innerWidth - rect.width - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, innerHeight - rect.height - 4))}px`;
  setTimeout(() => {
    document.addEventListener('mousedown', outside, true);
    document.addEventListener('keydown', onKey, true);
  });
  menu.querySelector('button')?.focus();
  return close;
}

// Modal dialog. build(box, close) fills it in.
export function openDialog(build, { className = 'dialog' } = {}) {
  const backdrop = document.getElementById('dialog');
  backdrop.textContent = '';
  const box = el('div', { class: className, role: 'dialog', 'aria-modal': 'true' });
  const close = () => {
    backdrop.hidden = true;
    backdrop.textContent = '';
    document.removeEventListener('keydown', onKey, true);
  };
  const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  backdrop.append(box);
  backdrop.hidden = false;
  backdrop.onmousedown = e => { if (e.target === backdrop) close(); };
  document.addEventListener('keydown', onKey, true);
  build(box, close);
  box.querySelector('input, textarea, button')?.focus();
  return close;
}

export function debounce(fn, ms) {
  let t;
  let pending = false;
  const wrapped = (...args) => { pending = true; clearTimeout(t); t = setTimeout(() => { pending = false; fn(...args); }, ms); };
  wrapped.flush = (...args) => { clearTimeout(t); pending = false; fn(...args); };
  wrapped.cancel = () => { clearTimeout(t); pending = false; };
  wrapped.isPending = () => pending;
  return wrapped;
}

export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
