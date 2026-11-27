// Pure helpers for the flow canvas and details panel.

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;
export const FAR_ZOOM = 0.6;
export const GRID = 16;

const clampZoom = k => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));

// view: screen = world * k + (x, y). Zooms keeping the world point under (cx, cy) fixed.
export function zoomAt(view, k, cx, cy) {
  const next = clampZoom(k);
  const wx = (cx - view.x) / view.k;
  const wy = (cy - view.y) / view.k;
  return { x: cx - wx * next, y: cy - wy * next, k: next };
}

// rects: { x, y, w, h } in world units.
export function fitView(rects, width, height, pad = 56) {
  if (!rects.length) return { x: 0, y: 0, k: 1 };
  const x0 = Math.min(...rects.map(r => r.x));
  const y0 = Math.min(...rects.map(r => r.y));
  const x1 = Math.max(...rects.map(r => r.x + r.w));
  const y1 = Math.max(...rects.map(r => r.y + r.h));
  const W = x1 - x0;
  const H = y1 - y0;
  const k = clampZoom(Math.min((width - 2 * pad) / (W || 1), (height - 2 * pad) / (H || 1), 1.2));
  return { x: (width - W * k) / 2 - x0 * k, y: (height - H * k) / 2 - y0 * k, k };
}

export const snap = n => Math.round(n / GRID) * GRID;

export function midEllipsis(text, max) {
  if (text.length <= max) return text;
  const keep = Math.max(0, max - 1);
  const head = Math.round(keep * 0.45);
  return text.slice(0, head) + '…' + text.slice(text.length - (keep - head));
}

export function edgeLabel(names) {
  const text = names.length <= 2 ? names.join(', ') : `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
  return { text, title: names.join(', ') };
}

export const isSensitiveName = name => /token|secret|password|key/i.test(name);
export const isSensitiveHeader = name => /^authorization$|^(set-)?cookie$|api-key/i.test(name);
