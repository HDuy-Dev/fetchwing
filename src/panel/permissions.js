import { reportIfGone } from './runtime.js';
// Host permission per origin, asked for from a click. chrome.permissions.request
// resolves immediately when the origins are already granted. If the DevTools
// panel can't show the prompt, a small extension page asks instead.

// Returns 'granted', 'denied', 'pending' (a grant window opened) or 'gone'
// (the extension was reloaded under this panel).
export function ensureOrigin(origin) {
  return ensureOrigins([origin]);
}

// One prompt for all the origins. Call it inside the click, before any await.
export async function ensureOrigins(origins) {
  if (!origins.length) return 'granted';
  try {
    const granted = await chrome.permissions.request({ origins: origins.map(o => `${o}/*`) });
    return granted ? 'granted' : 'denied';
  } catch (err) {
    if (reportIfGone(err)) return 'gone';
    try {
      const query = origins.map(o => `origin=${encodeURIComponent(o)}`).join('&');
      const url = chrome.runtime.getURL(`src/grant/grant.html?${query}`);
      window.open(url, 'fetchwing-grant', 'width=440,height=260');
      return 'pending';
    } catch (e) {
      if (reportIfGone(e)) return 'gone';
      throw e;
    }
  }
}
