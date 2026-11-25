// Same theme as the panel (shared extension origin), else the system theme.
let mode = null;
try { mode = JSON.parse(localStorage.getItem('fw.mode')); } catch {}
document.documentElement.dataset.mode = mode ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

import { completeGrant } from '../lib/grant-follow-up.js';

const params = new URLSearchParams(location.search);
const origin = params.get('origin') || '';
// Set when the toolbar popup opened this window: finish its job here.
const forSite = params.get('site') === '1';
document.getElementById('origin').textContent = origin;
document.getElementById('allow').addEventListener('click', async () => {
  const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
  const result = document.getElementById('result');
  if (!granted) {
    result.textContent = 'Access was not granted.';
    return;
  }
  if (forSite) {
    const error = await completeGrant({ send: msg => chrome.runtime.sendMessage(msg), origin, mockId: params.get('mock') });
    if (error) {
      result.textContent = error;
      return;
    }
    result.textContent = 'Done. Mocks now run on this site.';
  } else {
    result.textContent = 'Access granted. You can close this window and try again in Fetchwing.';
  }
  setTimeout(() => window.close(), 1200);
});
