// The panel's one way to message the background worker (see src/lib/runtime-send.js).

import { createSend, isGone } from '../lib/runtime-send.js';

function showNotice() {
  const notice = document.getElementById('goneNotice');
  if (notice) notice.hidden = false;
}

// For chrome.* calls that don't go through send: true (and the notice) when the
// error means the extension was reloaded under this panel.
export function reportIfGone(err) {
  if (!isGone(err)) return false;
  showNotice();
  return true;
}

export const send = createSend({
  sendMessage: msg => {
    // After a reload, chrome.runtime.id is gone even before sendMessage would throw.
    if (!chrome.runtime?.id) throw new Error('Extension context invalidated.');
    return chrome.runtime.sendMessage(msg);
  },
  onGone: showNotice,
});
