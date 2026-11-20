import {
  MAX_IMPORT_BYTES,
  createDefaultSave,
  validateAndSanitizeSave,
} from './logic.js';

const STORAGE_KEY = 'pdp_save_v1';
const BACKUPS_KEY = 'pdp_save_backups_v1';
const DEVICE_KEY = 'pdp_device_id_v1';
const SYNC_META_KEY = 'pdp_cloud_sync_meta_v1';

function safeGetItem(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key, val) {
  try {
    window.localStorage.setItem(key, val);
    return true;
  } catch {
    return false;
  }
}

export function getOrCreateDeviceId() {
  let id = safeGetItem(DEVICE_KEY);
  if (!id) {
    id = 'dev-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36);
    safeSetItem(DEVICE_KEY, id);
  }
  return id;
}

export function loadLocalSave() {
  const deviceId = getOrCreateDeviceId();
  const raw = safeGetItem(STORAGE_KEY);
  if (!raw) {
    const def = createDefaultSave(deviceId);
    safeSetItem(STORAGE_KEY, JSON.stringify(def));
    return { save: def, recovered: false };
  }
  try {
    const parsed = JSON.parse(raw);
    const res = validateAndSanitizeSave(parsed, { strict: false, fallbackDeviceId: deviceId });
    if (!res.ok || !res.save) {
      return { save: createDefaultSave(deviceId), recovered: true };
    }
    return { save: res.save, recovered: false };
  } catch {
    return { save: createDefaultSave(deviceId), recovered: true };
  }
}

export function saveLocalSave(saveDoc) {
  const deviceId = getOrCreateDeviceId();
  const res = validateAndSanitizeSave(saveDoc, { strict: false, fallbackDeviceId: deviceId });
  if (!res.ok || !res.save) return false;
  return safeSetItem(STORAGE_KEY, JSON.stringify(res.save));
}

export function createBackupSnapshot(docToBackup, reason = 'auto') {
  if (!docToBackup) return [];
  let backups = [];
  try {
    const raw = safeGetItem(BACKUPS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) backups = parsed;
    }
  } catch {
    backups = [];
  }
  backups.unshift({
    backedUpAt: new Date().toISOString(),
    reason,
    doc: docToBackup,
  });
  backups = backups.slice(0, 3);
  safeSetItem(BACKUPS_KEY, JSON.stringify(backups));
  return backups;
}

export function getBackups() {
  try {
    const raw = safeGetItem(BACKUPS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function exportSaveJson(saveDoc) {
  return JSON.stringify(saveDoc, null, 2);
}

export function validateImportedText(text, currentSave) {
  if (typeof text !== 'string') {
    return { ok: false, reason: 'Empty file' };
  }
  const byteLen = new TextEncoder().encode(text).length;
  if (byteLen > MAX_IMPORT_BYTES) {
    return { ok: false, reason: `File exceeds ${MAX_IMPORT_BYTES / 1024} KB limit` };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'Invalid JSON syntax' };
  }
  const deviceId = getOrCreateDeviceId();
  const res = validateAndSanitizeSave(parsed, { strict: true, fallbackDeviceId: deviceId });
  if (!res.ok || !res.save) {
    return { ok: false, reason: res.reason || 'Validation failed' };
  }
  // Backup current save before returning validated import
  if (currentSave) {
    createBackupSnapshot(currentSave, 'before-import');
  }
  return { ok: true, save: res.save };
}

export function resetProgress(currentSave) {
  if (currentSave) {
    createBackupSnapshot(currentSave, 'before-reset');
  }
  const fresh = createDefaultSave(getOrCreateDeviceId());
  fresh.settings = { ...(currentSave?.settings || fresh.settings) };
  saveLocalSave(fresh);
  return fresh;
}

export function loadCloudSyncMeta() {
  try {
    const raw = safeGetItem(SYNC_META_KEY);
    return raw ? JSON.parse(raw) : { lastSyncedRevision: null, lastSyncedRemoteVersion: null, fileId: null };
  } catch {
    return { lastSyncedRevision: null, lastSyncedRemoteVersion: null, fileId: null };
  }
}

export function saveCloudSyncMeta(meta) {
  return safeSetItem(SYNC_META_KEY, JSON.stringify(meta));
}
