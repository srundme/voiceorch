/**
 * Anonymous per-device identity for book progress.
 *
 * The book has no login. We mint one UUID the first time a browser loads the
 * app and keep it in localStorage; that UUID is the key the API uses to store
 * reading progress. If localStorage is unavailable (private mode, blocked
 * cookies) we fall back to an in-memory id so the session still works — it just
 * won't survive a reload.
 */
const STORAGE_KEY = "snapserve-book-device-id";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let memoryId: string | null = null;

function generateUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // RFC4122-ish fallback for ancient runtimes.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function getDeviceId(): string {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing && UUID_RE.test(existing)) return existing;
    const id = generateUuid();
    localStorage.setItem(STORAGE_KEY, id);
    return id;
  } catch {
    if (!memoryId) memoryId = generateUuid();
    return memoryId;
  }
}
