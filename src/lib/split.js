// Height limits for the draggable split between the request and Response/Mock.

export const MIN_RESPONSE = 120;

// null means "automatic": nothing saved, or the saved value is unusable.
export function clampSplit(height, { work, min, reserved }) {
  if (!Number.isFinite(height)) return null;
  return Math.round(Math.max(min, Math.min(height, work - reserved - MIN_RESPONSE)));
}
