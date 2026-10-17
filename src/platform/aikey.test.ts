import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory stand-in for IndexedDB, so dumpAll() runs for real in Node.
vi.mock('idb', () => {
  const stores = new Map<string, Map<unknown, unknown>>([['cards', new Map()], ['kv', new Map()]]);
  const store = (n: string) => stores.get(n)!;
  return {
    openDB: async () => ({
      get: async (n: string, k: unknown) => store(n).get(k),
      put: async (n: string, v: unknown, k: unknown) => { store(n).set(k, v); },
      getAll: async (n: string) => [...store(n).values()],
      getAllKeys: async (n: string) => [...store(n).keys()],
    }),
  };
});

const { consumeSetupLink, hasKey, loadKey, parseSetupFragment, saveKey } = await import('./aikey');
const { dumpAll, kvSet } = await import('./db');

const KEY = 'AIzaSy-test-secret-1234';

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; }, clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); },
  };
}

beforeEach(() => { vi.stubGlobal('localStorage', memoryStorage()); });

describe('Gemini key', () => {
  it('is saved in localStorage, trimmed, and removed when blank', () => {
    expect(hasKey()).toBe(false);
    saveKey(`  ${KEY} `);
    expect(loadKey()).toBe(KEY);
    expect(localStorage.getItem('turisfasih.gemini')).toBe(KEY);
    saveKey('');
    expect(hasKey()).toBe(false);
  });

  it('reads as no key when storage throws', () => {
    const blocked = { ...memoryStorage(), getItem: () => { throw new Error('denied'); } };
    expect(loadKey(blocked)).toBe('');
  });

  it('is never in a backup', async () => {
    saveKey(KEY);
    await kvSet('settings', { lang: 'ja' });
    await kvSet('mine:ja', [{ id: 'u-abc', native: '傘', reading: 'kasa', english: 'Umbrella', tags: ['shopping'], difficulty: 1, book: true, mine: true }]);
    const dump = JSON.stringify(await dumpAll());
    expect(dump).toContain('mine:ja');
    expect(dump).not.toContain(KEY);
    expect(dump).not.toContain('turisfasih.gemini');
  });
});

describe('setup link', () => {
  it('parses #setup?gemini=…', () => {
    expect(parseSetupFragment(`#setup?gemini=${KEY}`)).toBe(KEY);
    expect(parseSetupFragment('#setup?gemini=')).toBeNull();
    expect(parseSetupFragment(`#/phrasebook?gemini=${KEY}`)).toBeNull();
  });

  it('saves the key and strips it from the URL', () => {
    const replaceState = vi.fn();
    vi.stubGlobal('location', { hash: `#setup?gemini=${KEY}`, pathname: '/turisfasih/', search: '' });
    vi.stubGlobal('history', { replaceState });
    expect(consumeSetupLink()).toBe(true);
    expect(loadKey()).toBe(KEY);
    expect(replaceState).toHaveBeenCalledWith(null, '', '/turisfasih/#/settings');
  });
});
