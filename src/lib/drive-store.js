// Finds, creates, reads and writes the user's "Fetchwing data" JSON file
// through the Drive v3 REST API. With the drive.file scope only files this
// app created are visible.

import { DRIVE_FILE_NAME, APP_PROPERTY } from '../config.js';
import { AuthRequired, DriveAccessMissing } from './google-auth.js';

const FILES = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const BOUNDARY = 'fetchwing-boundary-7c1e';

export class FileMissing extends Error {}

export class ApiError extends Error {
  constructor(status) {
    super(`Google API error ${status}`);
    this.status = status;
  }
}

// A 403 caused by a token without the Drive scope (unticked on Google's
// consent screen, or removed later).
async function isMissingScope(res) {
  try {
    const { error } = await res.json();
    const reasons = [...(error?.details || []), ...(error?.errors || [])].map(d => d.reason);
    return reasons.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT') || reasons.includes('insufficientPermissions');
  } catch {
    return false;
  }
}

export function createDriveStore({ fetchFn, getToken, onUnauthorized }) {
  async function request(url, { method = 'GET', body, contentType } = {}) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetchFn(url, {
        method,
        headers: { Authorization: `Bearer ${await getToken()}`, ...(contentType ? { 'Content-Type': contentType } : {}) },
        body,
      });
      if (res.status === 401) {
        if (attempt > 0) throw new AuthRequired('Google rejected the token');
        await onUnauthorized();
        continue;
      }
      if (res.status === 404) throw new FileMissing('Drive file not found');
      if (res.status === 403 && (await isMissingScope(res))) throw new DriveAccessMissing('Drive permission not granted');
      if (res.status >= 400) throw new ApiError(res.status);
      return res.json();
    }
  }

  async function find() {
    const url = new URL(FILES);
    url.searchParams.set('q', `appProperties has { key='${APP_PROPERTY.key}' and value='${APP_PROPERTY.value}' } and trashed=false`);
    url.searchParams.set('spaces', 'drive');
    url.searchParams.set('fields', 'files(id)');
    const { files = [] } = await request(url.toString());
    return files[0]?.id ?? null;
  }

  async function create(data) {
    const meta = { name: DRIVE_FILE_NAME, mimeType: 'application/json', appProperties: { [APP_PROPERTY.key]: APP_PROPERTY.value } };
    const body = [
      `--${BOUNDARY}`, 'Content-Type: application/json; charset=UTF-8', '', JSON.stringify(meta),
      `--${BOUNDARY}`, 'Content-Type: application/json', '', JSON.stringify(data),
      `--${BOUNDARY}--`, '',
    ].join('\r\n');
    const { id } = await request(`${UPLOAD}?uploadType=multipart&fields=id`, { method: 'POST', body, contentType: `multipart/related; boundary=${BOUNDARY}` });
    return id;
  }

  const read = fileId => request(`${FILES}/${encodeURIComponent(fileId)}?alt=media`);

  async function write(fileId, data) {
    await request(`${UPLOAD}/${encodeURIComponent(fileId)}?uploadType=media`, { method: 'PATCH', body: JSON.stringify(data), contentType: 'application/json' });
  }

  return { find, create, read, write };
}
