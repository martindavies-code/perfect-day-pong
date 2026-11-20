import { GOOGLE_CLIENT_ID, GOOGLE_SCOPES, CLOUD_SAVE_FILENAME } from './config.js';
import { detectCloudConflict, validateAndSanitizeSave } from './logic.js';
import {
  createBackupSnapshot,
  loadCloudSyncMeta,
  saveCloudSyncMeta,
} from './storage.js';

/**
 * Google Identity Services (token model) + Drive v3 appDataFolder client.
 * Access token stays strictly in memory (never logged, never written to storage).
 * Conflict policy lives in logic.js (detectCloudConflict).
 */
export function createCloudManager() {
  let tokenClient = null;
  let accessToken = null;
  let tokenExpiresAt = 0;
  let scriptLoadPromise = null;
  let uploadDebounceTimer = null;

  function isConfigured() {
    return Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_ID.trim().length > 10);
  }

  function isSignedIn() {
    return Boolean(accessToken && Date.now() < tokenExpiresAt - 5000);
  }

  function loadGisScript() {
    if (window.google?.accounts?.oauth2) return Promise.resolve(true);
    if (scriptLoadPromise) return scriptLoadPromise;
    scriptLoadPromise = new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.defer = true;
      s.onload = () => resolve(Boolean(window.google?.accounts?.oauth2));
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
    return scriptLoadPromise;
  }

  async function signInFromClick() {
    if (!isConfigured()) {
      return { ok: false, reason: 'Cloud save not set up yet (missing GOOGLE_CLIENT_ID).' };
    }
    const loaded = await loadGisScript();
    if (!loaded || !window.google?.accounts?.oauth2) {
      return { ok: false, reason: 'Could not load Google Identity Services (offline or blocked).' };
    }

    return new Promise((resolve) => {
      tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID.trim(),
        scope: GOOGLE_SCOPES,
        callback: (resp) => {
          if (resp && resp.access_token) {
            accessToken = resp.access_token;
            const ttl = Number(resp.expires_in) || 3500;
            tokenExpiresAt = Date.now() + ttl * 1000;
            resolve({ ok: true });
          } else {
            resolve({ ok: false, reason: resp?.error_description || resp?.error || 'Sign-in cancelled.' });
          }
        },
        error_callback: (err) => {
          resolve({ ok: false, reason: err?.message || 'Google sign-in failed.' });
        },
      });
      tokenClient.requestAccessToken({ prompt: '' });
    });
  }

  function signOut() {
    const tok = accessToken;
    accessToken = null;
    tokenExpiresAt = 0;
    if (tok && window.google?.accounts?.oauth2?.revoke) {
      try {
        window.google.accounts.oauth2.revoke(tok, () => {});
      } catch {
        // ignore
      }
    }
  }

  async function driveFetch(url, options = {}) {
    if (!isSignedIn()) {
      const err = new Error('Not signed in');
      err.status = 401;
      throw err;
    }
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${accessToken}`);
    const res = await fetch(url, { ...options, headers });
    if (res.status === 401) {
      accessToken = null;
      tokenExpiresAt = 0;
    }
    return res;
  }

  async function findSaveFile() {
    const q = encodeURIComponent(`name='${CLOUD_SAVE_FILENAME}' and trashed=false`);
    const url = `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id,name,version,md5Checksum,modifiedTime)`;
    const res = await driveFetch(url);
    if (!res.ok) {
      const err = new Error(`Drive list failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    return data.files?.[0] || null;
  }

  async function readRemoteSave() {
    const file = await findSaveFile();
    if (!file) {
      return { file: null, remoteSave: null, remoteVersion: null };
    }
    const res = await driveFetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`
    );
    if (!res.ok) {
      const err = new Error(`Drive download failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    let parsed;
    try {
      parsed = await res.json();
    } catch {
      const err = new Error('Cloud save file is corrupt JSON; local save kept untouched.');
      err.status = 422;
      throw err;
    }
    const valid = validateAndSanitizeSave(parsed, { strict: true });
    if (!valid.ok || !valid.save) {
      const err = new Error(`Cloud save failed validation (${valid.reason}); local save kept.`);
      err.status = 422;
      throw err;
    }
    const remoteVersion = file.md5Checksum || String(file.version || file.modifiedTime || '');
    return { file, remoteSave: valid.save, remoteVersion };
  }

  async function uploadSaveFile(localSave, existingFileId = null) {
    const metadata = existingFileId
      ? { name: CLOUD_SAVE_FILENAME }
      : { name: CLOUD_SAVE_FILENAME, parents: ['appDataFolder'] };
    const boundary = 'pdp_' + Math.random().toString(36).slice(2);
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify(metadata) +
      `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n` +
      JSON.stringify(localSave) +
      `\r\n--${boundary}--`;

    const url = existingFileId
      ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existingFileId)}?uploadType=multipart&fields=id,version,md5Checksum,modifiedTime`
      : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,version,md5Checksum,modifiedTime`;

    const res = await driveFetch(url, {
      method: existingFileId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
    if (!res.ok) {
      const err = new Error(`Drive upload failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    const updated = await res.json();
    const ver = updated.md5Checksum || String(updated.version || updated.modifiedTime || '');
    saveCloudSyncMeta({
      fileId: updated.id,
      lastSyncedRevision: localSave.revision,
      lastSyncedRemoteVersion: ver,
    });
    return updated;
  }

  async function syncBeforeUpload(localSave) {
    if (!isSignedIn()) return { action: 'not_signed_in' };
    try {
      const meta = loadCloudSyncMeta();
      const { file, remoteSave, remoteVersion } = await readRemoteSave();
      if (!file || !remoteSave) {
        await uploadSaveFile(localSave, null);
        return { action: 'uploaded_initial' };
      }

      const decision = detectCloudConflict({
        localSave,
        remoteSave,
        lastSyncedRevision: meta.lastSyncedRevision,
        lastSyncedRemoteVersion: meta.lastSyncedRemoteVersion,
        remoteVersion,
      });

      if (decision.status === 'in_sync') {
        return { action: 'in_sync' };
      }
      if (decision.status === 'upload_local') {
        await uploadSaveFile(localSave, file.id);
        return { action: 'uploaded' };
      }
      if (decision.status === 'pull_remote') {
        createBackupSnapshot(localSave, 'before-cloud-pull');
        saveCloudSyncMeta({
          fileId: file.id,
          lastSyncedRevision: remoteSave.revision,
          lastSyncedRemoteVersion: remoteVersion,
        });
        return { action: 'pulled', remoteSave };
      }

      // Conflict: do not overwrite and do not merge
      return {
        action: 'conflict',
        localSave,
        remoteSave,
        fileId: file.id,
        remoteVersion,
      };
    } catch (err) {
      if (err.status === 401) {
        return { action: 'auth_expired', message: 'Google session expired. Sign in again to sync.' };
      }
      if (err.status === 403) {
        return { action: 'error', message: 'Google Drive quota or permission denied. Playing locally.' };
      }
      return { action: 'error', message: err.message || 'Offline or sync failed. Playing locally.' };
    }
  }

  async function resolveUseCloud(conflict) {
    createBackupSnapshot(conflict.localSave, 'before-use-cloud');
    saveCloudSyncMeta({
      fileId: conflict.fileId,
      lastSyncedRevision: conflict.remoteSave.revision,
      lastSyncedRemoteVersion: conflict.remoteVersion,
    });
    return conflict.remoteSave;
  }

  async function resolveUseLocal(conflict) {
    createBackupSnapshot(conflict.remoteSave, 'cloud-replaced-by-local');
    await uploadSaveFile(conflict.localSave, conflict.fileId);
    return conflict.localSave;
  }

  function scheduleDebouncedSync(getLocalSave, onResult) {
    if (!isSignedIn()) return;
    if (uploadDebounceTimer) clearTimeout(uploadDebounceTimer);
    uploadDebounceTimer = setTimeout(async () => {
      const res = await syncBeforeUpload(getLocalSave());
      onResult?.(res);
    }, 1200);
  }

  return {
    isConfigured,
    isSignedIn,
    signInFromClick,
    signOut,
    syncBeforeUpload,
    resolveUseCloud,
    resolveUseLocal,
    scheduleDebouncedSync,
  };
}
