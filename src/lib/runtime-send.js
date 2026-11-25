// Messages to the background worker that never throw. After the extension is
// reloaded, a DevTools panel opened before stays on screen but can no longer
// reach it; that case is reported once through onGone so the page can say so.

export const GONE_ERROR = 'Fetchwing was reloaded. Close and reopen DevTools to keep using it.';

export const isGone = err => /Extension context invalidated/i.test(String(err?.message ?? err));

export function createSend({ sendMessage, onGone }) {
  let reported = false;
  return async msg => {
    try {
      const res = await sendMessage(msg);
      return res ?? { ok: false, error: 'Could not reach Fetchwing.' };
    } catch (err) {
      if (!isGone(err)) return { ok: false, error: `Could not reach Fetchwing: ${err?.message ?? err}` };
      if (!reported) { reported = true; onGone(); }
      return { ok: false, error: GONE_ERROR };
    }
  };
}
