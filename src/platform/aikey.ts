/**
 * The user's Gemini key. It lives in localStorage only, never in IndexedDB, so backups never carry it.
 * Every access is guarded: storage can be blocked, and then AI words are simply off.
 */
const STORE_KEY = 'turisfasih.gemini';

export function loadKey(storage: Storage = localStorage): string {
  try { return storage.getItem(STORE_KEY)?.trim() ?? ''; } catch { return ''; }
}

/** Saves the key, or removes it when blank. Returns what was saved. */
export function saveKey(key: string, storage: Storage = localStorage): string {
  const clean = key.trim();
  if (clean) storage.setItem(STORE_KEY, clean); else storage.removeItem(STORE_KEY);
  return clean;
}

export const hasKey = () => !!loadKey();

/** The key from a "#setup?gemini=…" link, or null when the fragment is not one. */
export function parseSetupFragment(hash: string): string | null {
  if (!hash.startsWith('#setup')) return null;
  const v = new URLSearchParams(hash.slice('#setup'.length).replace(/^[?&]/, '')).get('gemini')?.trim();
  return v || null;
}

/** Saves a key from a setup link and strips it from the URL. Returns whether a key was saved. */
export function consumeSetupLink(): boolean {
  const key = parseSetupFragment(location.hash);
  if (!key) return false;
  history.replaceState(null, '', `${location.pathname}${location.search}#/settings`);
  try { saveKey(key); return true; } catch { return false; }
}
