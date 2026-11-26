// Drag handle that sets the request height; Response/Mock takes the rest.

import { MIN_RESPONSE, clampSplit } from '../lib/split.js';

const KEY = 'reqHeight';
const STEP = 16;

export function initSplit({ work, req, handle, store }) {
  const limits = () => {
    const urlbar = req.querySelector('.urlbar');
    // The URL bar wraps to two rows when narrow, so measure it. scrollTop keeps this stable while scrolled.
    const min = urlbar ? urlbar.getBoundingClientRect().bottom - req.getBoundingClientRect().top + req.scrollTop + 8 : 0;
    return { work: work.clientHeight, min: Math.ceil(min), reserved: handle.offsetHeight + parseFloat(getComputedStyle(handle).marginTop || 0) };
  };

  // Never writes to the store: a short panel must not overwrite the saved height.
  const apply = () => {
    if (!work.offsetHeight || !handle.offsetHeight) return;
    const box = limits();
    const height = clampSplit(store.get(KEY, null), box);
    req.classList.toggle('sized', height !== null);
    if (height === null) req.style.removeProperty('--req-h');
    else req.style.setProperty('--req-h', `${height}px`);
    handle.setAttribute('aria-valuemin', box.min);
    handle.setAttribute('aria-valuemax', Math.max(box.min, box.work - box.reserved - MIN_RESPONSE));
    handle.setAttribute('aria-valuenow', height ?? req.offsetHeight);
  };

  const resize = height => {
    store.set(KEY, clampSplit(height, limits()));
    apply();
  };

  let drag = null;
  const end = () => {
    drag = null;
    handle.classList.remove('dragging');
  };
  handle.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    drag = { y: e.clientY, height: req.offsetHeight, moved: false };
    handle.classList.add('dragging');
  });
  handle.addEventListener('pointermove', e => {
    if (!drag || (!drag.moved && e.clientY === drag.y)) return;
    drag.moved = true;
    resize(drag.height + e.clientY - drag.y);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) handle.addEventListener(type, end);

  handle.addEventListener('dblclick', () => {
    store.set(KEY, null);
    apply();
  });
  handle.addEventListener('keydown', e => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    resize(req.offsetHeight + (e.key === 'ArrowUp' ? -STEP : STEP));
  });
  handle.addEventListener('focus', apply);
  new ResizeObserver(apply).observe(work);
}
