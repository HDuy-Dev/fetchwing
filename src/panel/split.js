// Drag handles: request height against Response/Mock, and sidebar width.

import { MIN_RESPONSE, SIDE_MIN, SIDE_MAX, MIN_WORK, clampSplit, clampSide } from '../lib/split.js';

const STEP = 16;
const DRAG_SLOP = 3; // pointer jitter during a click is not a drag

// Pointer, double-click and arrow keys. pos names the pointer coordinate;
// keys are the [shrink, grow] arrows; resize(size) saves, reset() clears.
function bindHandle(handle, { pos, keys, size, resize, reset }) {
  let drag = null;
  const end = () => {
    drag = null;
    handle.classList.remove('dragging');
  };
  handle.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault(); // also stops the browser focusing the handle, so do it here
    handle.focus({ preventScroll: true });
    handle.setPointerCapture(e.pointerId);
    drag = { from: e[pos], size: size(), moved: false };
    handle.classList.add('dragging');
  });
  handle.addEventListener('pointermove', e => {
    if (!drag || (!drag.moved && Math.abs(e[pos] - drag.from) < DRAG_SLOP)) return;
    drag.moved = true;
    resize(drag.size + e[pos] - drag.from);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) handle.addEventListener(type, end);
  handle.addEventListener('dblclick', reset);
  handle.addEventListener('keydown', e => {
    const step = keys.indexOf(e.key);
    if (step === -1) return;
    e.preventDefault();
    resize(size() + (step ? STEP : -STEP));
  });
}

// apply() never writes to the store: a small panel must not overwrite the saved size.
function sizer({ target, handle, store, key, cssVar, current, clamp, range }) {
  const apply = () => {
    const box = range();
    if (!box) return; // hidden
    const value = clamp(store.get(key, null), box);
    target.classList.toggle('sized', value !== null);
    if (value === null) target.style.removeProperty(cssVar);
    else target.style.setProperty(cssVar, `${value}px`);
    handle.setAttribute('aria-valuemin', box.min);
    handle.setAttribute('aria-valuemax', box.max);
    handle.setAttribute('aria-valuenow', value ?? current());
  };
  const save = value => {
    store.set(key, value);
    apply();
  };
  handle.addEventListener('focus', apply);
  return { apply, resize: value => save(clamp(value, range())), reset: () => save(null) };
}

export function initSplit({ work, req, handle, store }) {
  const current = () => req.offsetHeight;
  const range = () => {
    if (!work.offsetHeight || !handle.offsetHeight) return null;
    const urlbar = req.querySelector('.urlbar');
    // The URL bar wraps to two rows when narrow, so measure it. scrollTop keeps this stable while scrolled.
    const min = Math.ceil(urlbar ? urlbar.getBoundingClientRect().bottom - req.getBoundingClientRect().top + req.scrollTop + 8 : 0);
    const reserved = handle.offsetHeight + parseFloat(getComputedStyle(handle).marginTop || 0);
    return { work: work.clientHeight, min, reserved, max: Math.max(min, work.clientHeight - reserved - MIN_RESPONSE) };
  };
  const split = sizer({ target: req, handle, store, key: 'reqHeight', cssVar: '--req-h', current, clamp: clampSplit, range });
  bindHandle(handle, { pos: 'clientY', keys: ['ArrowUp', 'ArrowDown'], size: current, resize: split.resize, reset: split.reset });
  new ResizeObserver(split.apply).observe(work);
}

export function initSideResize({ body, rail, side, handle, store }) {
  const current = () => side.offsetWidth;
  const range = () => {
    if (!handle.offsetWidth) return null; // drawer mode
    const room = body.clientWidth - rail.offsetWidth;
    return { room, min: SIDE_MIN, max: Math.max(SIDE_MIN, Math.min(SIDE_MAX, room - MIN_WORK)) };
  };
  const split = sizer({ target: side, handle, store, key: 'sideWidth', cssVar: '--side-w', current, clamp: (v, box) => clampSide(v, box.room), range });
  bindHandle(handle, { pos: 'clientX', keys: ['ArrowLeft', 'ArrowRight'], size: current, resize: split.resize, reset: split.reset });
  new ResizeObserver(split.apply).observe(body);
}
