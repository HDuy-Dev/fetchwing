// The editor window: the DevTools panel page opened on its own, on one request's mock.

const PAGE = 'src/panel/panel.html';

export function editorUrl(requestId, tabId) {
  const params = new URLSearchParams({ window: '1', request: requestId });
  if (tabId) params.set('tabId', String(tabId));
  return `${PAGE}?${params}`;
}

export function editorParams(search) {
  const params = new URLSearchParams(search);
  return {
    isEditor: params.get('window') === '1',
    requestId: params.get('request'),
    tabId: Number(params.get('tabId')) || null,
  };
}

const isEditorPage = (url, pageUrl) => {
  const [path, search = ''] = String(url).split('?');
  return path === pageUrl && editorParams(search).isEditor;
};

// Shows the request in the editor window, opening one only if there is none.
export async function openEditorWindow(chrome, { requestId, tabId }) {
  const pageUrl = chrome.runtime.getURL(PAGE);
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['TAB'] });
  const open = contexts.find(c => isEditorPage(c.documentUrl, pageUrl));
  if (open) {
    try {
      // Written first: focusing the window closes the popup. `at` makes a repeat count as a change.
      await chrome.storage.session.set({ reveal: { requestId, tabId: tabId ?? null, at: Date.now() } });
      await chrome.windows.update(open.windowId, { focused: true });
      return;
    } catch {
      // The window closed in the meantime; open a fresh one.
    }
  }
  await chrome.windows.create({ url: chrome.runtime.getURL(editorUrl(requestId, tabId)), type: 'popup', width: 1000, height: 700 });
}
