// One sync round against the user's "Fetchwing data" Drive file, plus the
// sign-in / sign-out flows. All I/O is injected so this runs in tests.
//
// Round: make sure the file exists -> read it -> merge it into the current
// workspace inside the worker's write queue -> upload if this device has
// anything newer.

import { emptyWorkspace } from './model.js';
import { mergeRemote, toRemote, isPristine, REMOTE_VERSION } from './sync-merge.js';
import { AuthRequired, DriveAccessMissing } from './google-auth.js';
import { ApiError, FileMissing } from './drive-store.js';

class NotFetchwingData extends Error {}

function describe(err) {
  if (err instanceof AuthRequired) return { state: 'signin', error: 'Please sign in again' };
  if (err instanceof DriveAccessMissing) return { state: 'drive', error: 'Allow Google Drive access to sync' };
  if (err instanceof TypeError) return { state: 'error', error: "Can't reach Google" };
  if (err instanceof ApiError) return { state: 'error', error: `Google returned an error (${err.status})` };
  if (err instanceof NotFetchwingData) return { state: 'error', error: 'The Drive file "Fetchwing data" is damaged' };
  return { state: 'error', error: err?.message || 'Unknown error' };
}

const isRemote = data => data && typeof data === 'object' && data.version === REMOTE_VERSION && data.items && data.environments;

export function createSyncer({ getWorkspace, updateWorkspace, setStatus, auth, store, local, now }) {
  let running = null;
  let again = false;
  let pending = null; // { email, previousEmail } awaiting the user's answer

  const getLocal = async key => (await local.get(key))[key];

  // Returns { fileId, remote } — remote is set when the file was just created.
  async function ensureFile(email) {
    const known = await getLocal('driveFile');
    if (known?.email === email && known.fileId) return { fileId: known.fileId };
    let fileId = await store.find();
    let remote;
    if (!fileId) {
      remote = toRemote(await getWorkspace());
      fileId = await store.create(remote);
    }
    await local.set({ driveFile: { fileId, email } });
    return { fileId, remote };
  }

  async function once() {
    const account = await auth.getAccount();
    if (!account) {
      await setStatus({ state: 'off', email: null, error: null });
      return;
    }
    const { email } = account;
    await setStatus({ state: 'syncing', email });
    try {
      await auth.getToken({ interactive: false });
      let { fileId, remote } = await ensureFile(email);
      if (!remote) {
        try {
          remote = await store.read(fileId);
        } catch (err) {
          if (!(err instanceof FileMissing)) throw err;
          // The user deleted the file in Drive: start a new one with everything.
          await local.remove('driveFile');
          ({ fileId, remote } = await ensureFile(email));
          remote ??= await store.read(fileId);
        }
      }
      if (!isRemote(remote)) throw new NotFetchwingData();
      let upload = false;
      // Merging against the workspace inside the write queue keeps edits made during the round.
      const merged = await updateWorkspace(current => {
        const result = mergeRemote(current, remote);
        upload = result.upload;
        return result.workspace;
      });
      if (upload) await store.write(fileId, toRemote(merged));
      await local.set({ lastSyncedEmail: email });
      await setStatus({ state: 'ok', email, error: null, lastSyncAt: now() });
    } catch (err) {
      await setStatus({ ...describe(err), email });
    }
  }

  // Calls made during a round share it and trigger exactly one more round.
  function round() {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          await once();
        } while (again);
      } finally {
        running = null;
      }
    })();
    return running;
  }

  async function commit(email) {
    const known = await getLocal('driveFile');
    if (known && known.email !== email) await local.remove('driveFile');
    await local.set({ account: { email } });
    pending = null;
    round();
    return { ok: true };
  }

  async function signIn({ forceConsent = false } = {}) {
    let email;
    try {
      ({ email } = await auth.signIn({ forceConsent }));
    } catch (err) {
      if (err instanceof DriveAccessMissing) {
        await setStatus({ state: 'drive', error: 'Allow Google Drive access to sync' });
        return { ok: false, error: 'Allow Google Drive access to sync' };
      }
      if (err instanceof AuthRequired) return { ok: false, error: 'Sign-in was cancelled' };
      return { ok: false, error: describe(err).error };
    }
    const previousEmail = await getLocal('lastSyncedEmail');
    if (previousEmail && previousEmail !== email && !isPristine(await getWorkspace())) {
      pending = { email, previousEmail };
      await setStatus({ state: 'confirm', email, error: null });
      return { ok: false, confirm: { email, previousEmail } };
    }
    return commit(email);
  }

  // choice: 'merge' keeps this device's data, 'replace' takes the account's
  // Drive data instead, 'cancel' signs out again.
  async function confirmAccount(choice) {
    if (!pending) return { ok: false, error: 'Nothing to confirm' };
    if (choice === 'cancel') {
      pending = null;
      await auth.signOut();
      await setStatus({ state: 'off', email: null, error: null });
      return { ok: true };
    }
    if (choice === 'replace') await updateWorkspace(() => emptyWorkspace());
    return commit(pending.email);
  }

  async function signOut() {
    if (await auth.getAccount()) await round();
    await auth.signOut();
    await local.remove('driveFile');
    pending = null;
    await setStatus({ state: 'off', email: null, error: null });
    return { ok: true };
  }

  return { round, signIn, confirmAccount, signOut };
}
