import { reportIfGone } from './runtime.js';
// Host permission per origin, asked for from a click. chrome.permissions.request
// resolves immediately when the origin is already granted. If the DevTools
// panel can't show the prompt, a small extension page asks instead.

// Returns 'granted', 'denied', 'pending' (a grant window opened) or 'gone'
// (the extension was reloaded under this panel).
export async function ensureOrigin(origin) {
  const pattern = `${origin}/*`;
  try {
    const granted = await chrome.permissions.request({ origins: [pattern] });
    return granted ? 'granted' : 'denied';
  } catch (err) {
    if (reportIfGone(err)) return 'gone';
    try {
      const url = chrome.runtime.getURL(`src/grant/grant.html?origin=${encodeURIComponent(origin)}`);
      window.open(url, 'fetchwing-grant', 'width=440,height=260');
      return 'pending';
    } catch (e) {
      if (reportIfGone(e)) return 'gone';
      throw e;
    }
  }
}
