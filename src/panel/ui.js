// Small DOM helpers shared by the panel views.

export function el(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
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

let toastTimer;
export function toast(message, ms = 2600) {
  const t = document.getElementById('toast');
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

// Context menu. items: { label, action, danger?, confirm? } | 'sep'
export function showMenu(x, y, items) {
  const menu = document.getElementById('menu');
  menu.textContent = '';
  const close = () => { menu.hidden = true; document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', onKey, true); };
  const outside = e => { if (!menu.contains(e.target)) close(); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  for (const item of items) {
    if (item === 'sep') { menu.append(el('div', { class: 'sep' })); continue; }
    menu.append(el('button', {
      type: 'button',
      role: 'menuitem',
      class: item.danger ? 'danger' : '',
      onclick: () => {
        if (item.confirm) {
          menu.textContent = '';
          menu.append(
            el('div', { class: 'confirm' }, item.confirm),
            el('button', { type: 'button', class: 'danger', onclick: () => { close(); item.action(); } }, 'Delete'),
            el('button', { type: 'button', onclick: close }, 'Cancel'),
          );
          return;
        }
        close();
        item.action();
      },
    }, item.label));
  }
  menu.hidden = false;
  const { innerWidth, innerHeight } = window;
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, innerWidth - rect.width - 4)}px`;
  menu.style.top = `${Math.min(y, innerHeight - rect.height - 4)}px`;
  setTimeout(() => {
    document.addEventListener('mousedown', outside, true);
    document.addEventListener('keydown', onKey, true);
  });
  menu.querySelector('button')?.focus();
}

// Modal dialog. build(dialogEl, close) fills it in.
export function openDialog(build) {
  const backdrop = document.getElementById('dialog');
  backdrop.textContent = '';
  const box = el('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true' });
  const close = () => { backdrop.hidden = true; backdrop.textContent = ''; document.removeEventListener('keydown', onKey, true); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  backdrop.append(box);
  backdrop.hidden = false;
  backdrop.onmousedown = e => { if (e.target === backdrop) close(); };
  document.addEventListener('keydown', onKey, true);
  build(box, close);
  box.querySelector('textarea, input, button')?.focus();
  return close;
}

export function debounce(fn, ms) {
  let t;
  const wrapped = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  wrapped.flush = (...args) => { clearTimeout(t); fn(...args); };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
