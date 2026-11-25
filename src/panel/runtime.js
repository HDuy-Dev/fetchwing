// The panel's one way to message the background worker (see src/lib/runtime-send.js).

import { createSend } from '../lib/runtime-send.js';

export const send = createSend({
  sendMessage: msg => {
    // After a reload, chrome.runtime.id is gone even before sendMessage would throw.
    if (!chrome.runtime?.id) throw new Error('Extension context invalidated.');
    return chrome.runtime.sendMessage(msg);
  },
  onGone: () => {
    const notice = document.getElementById('goneNotice');
    if (notice) notice.hidden = false;
  },
});
