// Isolated-world bridge: hands the enabled mocks from extension storage to
// the page runtime (mock-main.js) and keeps it updated.
(() => {
  if (window.__fetchwingBridge) return;
  window.__fetchwingBridge = true;

  // null until storage has answered: posting an empty list early would tell
  // the page "no mocks" and let its first requests through.
  let latest = null;
  const post = () => {
    if (latest) window.postMessage({ source: 'fetchwing-bridge', type: 'mocks', mocks: latest }, '*');
  };

  chrome.storage.local.get('activeMocks').then(({ activeMocks }) => {
    latest = activeMocks || [];
    post();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.activeMocks) return;
    latest = changes.activeMocks.newValue || [];
    post();
  });

  // The page runtime may start after our first post; resend when it says so.
  window.addEventListener('message', event => {
    if (event.source === window && event.data?.source === 'fetchwing-main' && event.data.type === 'ready') post();
  });
})();
