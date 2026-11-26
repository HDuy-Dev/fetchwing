// Copy and rules for the request editor's Body tab and its key/value tables.

export const BODY_MODES = [['none', 'None'], ['json', 'JSON'], ['text', 'Text'], ['urlencoded', 'URL-encoded'], ['formdata', 'Form data']];

export function bodyBadge(mode) {
  return mode === 'none' ? null : BODY_MODES.find(([value]) => value === mode)?.[1] ?? null;
}

// buildSend drops the body for these methods.
export function bodylessWarning(method, mode) {
  if (mode === 'none' || (method !== 'GET' && method !== 'HEAD')) return null;
  return `${method} requests don't send a body. Change the method to send it.`;
}

export function blankRowLabels(kind) {
  return { key: kind === 'header' ? 'Add header' : 'Add key', value: 'Add value' };
}
