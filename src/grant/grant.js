// Same theme as the panel (shared extension origin), else the system theme.
let mode = null;
try { mode = JSON.parse(localStorage.getItem('fw.mode')); } catch {}
document.documentElement.dataset.mode = mode ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

import { completeGrant } from '../lib/grant-follow-up.js';

const params = new URLSearchParams(location.search);
// One origin from the popup and the request editor, several from a flow's Run.
const origins = params.getAll('origin').filter(Boolean);
const origin = origins[0] || '';
// Set when the toolbar popup opened this window: finish its job here.
const forSite = params.get('site') === '1';
document.getElementById('origin').textContent = origins.join(', ');
document.getElementById('allow').addEventListener('click', async () => {
  const granted = await chrome.permissions.request({ origins: origins.map(o => `${o}/*`) });
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
