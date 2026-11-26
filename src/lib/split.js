// Height limits for the draggable split between the request and Response/Mock.

export const MIN_RESPONSE = 120;

// null means "automatic": nothing saved, or the saved value is unusable.
export function clampSplit(height, { work, min, reserved }) {
  if (!Number.isFinite(height)) return null;
  return Math.round(Math.max(min, Math.min(height, work - reserved - MIN_RESPONSE)));
}

export const SIDE_MIN = 200;
export const SIDE_MAX = 480;
export const MIN_WORK = 360;

// room: the sidebar and work area together.
export function clampSide(width, room) {
  if (!Number.isFinite(width)) return null;
  return Math.round(Math.max(SIDE_MIN, Math.min(width, SIDE_MAX, room - MIN_WORK)));
}
