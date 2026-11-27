// Runs request scripts in the sandboxed page (src/sandbox/script.html): MV3
// extension pages can't eval, sandboxed pages can. Each run gets a fresh
// hidden iframe, thrown away afterwards, so one script can't watch or answer
// for the next.

export const TIMEOUT_ERROR = 'Script timed out after 5 s';

// createFrame(onMessage) → { post(msg), destroy() }
export function createScriptRunner({ createFrame, timeoutMs = 5000, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let frame = null;
  let ready = null;
  let pending = null; // { runId, resolve }
  let nextId = 1;
  let queue = Promise.resolve();

  const onMessage = data => {
    if (!data || data.source !== 'fetchwing-sandbox') return;
    if (data.type === 'ready') ready?.resolve();
    else if (data.type === 'result' && pending && data.runId === pending.runId) {
      const { logs = [], changes = [], error } = data;
      pending.resolve(error === undefined ? { logs, changes } : { logs, changes, error });
    }
  };

  const ensureFrame = () => {
    if (frame) return ready.promise;
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    ready = { promise, resolve };
    frame = createFrame(onMessage);
    return promise;
  };

  const runOne = ({ script, response, vars }) => new Promise(resolve => {
    const runId = nextId++;
    const timer = setTimer(() => {
      pending = null;
      frame?.destroy();
      frame = null;
      ready = null;
      resolve({ logs: [], changes: [], error: TIMEOUT_ERROR });
    }, timeoutMs);
    pending = {
      runId,
      resolve: result => {
        clearTimer(timer);
        pending = null;
        frame?.destroy();
        frame = null;
        ready = null;
        resolve(result);
      },
    };
    ensureFrame().then(() => {
      if (pending?.runId === runId) frame.post({ source: 'fetchwing-panel', type: 'run', runId, script, response, vars });
    });
  });

  return {
    // Runs one script at a time, in the order asked.
    run(job) {
      const result = queue.then(() => runOne(job));
      queue = result.catch(() => {});
      return result;
    },
  };
}

// The real frame: a hidden iframe on the sandboxed page.
export function iframeFrame(doc = document) {
  return onMessage => {
    const iframe = doc.createElement('iframe');
    iframe.src = new URL('../sandbox/script.html', import.meta.url).href;
    iframe.hidden = true;
    iframe.setAttribute('aria-hidden', 'true');
    iframe.tabIndex = -1;
    const listener = event => { if (event.source === iframe.contentWindow) onMessage(event.data); };
    doc.defaultView.addEventListener('message', listener);
    doc.body.append(iframe);
    return {
      post: msg => iframe.contentWindow?.postMessage(msg, '*'),
      destroy() {
        doc.defaultView.removeEventListener('message', listener);
        iframe.remove();
      },
    };
  };
}
