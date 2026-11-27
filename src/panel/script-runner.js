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
      const { logs = [], changes = [], error, value } = data;
      const out = pending.logic ? { logs } : { logs, changes };
      if (pending.logic && value !== undefined) out.value = value;
      if (error !== undefined) out.error = error;
      pending.resolve(out);
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

  const CANCELLED = { logs: [], cancelled: true, error: 'Stopped' };
  let epoch = 0; // bumped by cancel(): jobs queued before it resolve as cancelled

  const teardown = () => {
    frame?.destroy();
    frame = null;
    ready = null;
  };

  const runOne = job => new Promise(resolve => {
    const logic = job.mode === 'logic';
    const runId = nextId++;
    const timer = setTimer(() => {
      pending = null;
      teardown();
      resolve(logic ? { logs: [], error: TIMEOUT_ERROR, timedOut: true } : { logs: [], changes: [], error: TIMEOUT_ERROR });
    }, timeoutMs);
    pending = {
      runId,
      logic,
      resolve: result => {
        clearTimer(timer);
        pending = null;
        teardown();
        resolve(result);
      },
    };
    const msg = logic
      ? { source: 'fetchwing-panel', type: 'logic', runId, script: job.script, vars: job.vars, env: job.env }
      : { source: 'fetchwing-panel', type: 'run', runId, script: job.script, response: job.response, vars: job.vars };
    ensureFrame().then(() => {
      if (pending?.runId === runId) frame.post(msg);
    });
  });

  return {
    // Runs one script at a time, in the order asked.
    run(job) {
      const at = epoch;
      const result = queue.then(() => (at === epoch ? runOne(job) : { ...CANCELLED }));
      queue = result.catch(() => {});
      return result;
    },
    // Stops the running job and drops the queued ones; later jobs run normally.
    cancel() {
      epoch++;
      if (pending) pending.resolve({ ...CANCELLED });
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
