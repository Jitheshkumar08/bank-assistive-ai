import '@testing-library/jest-dom/vitest';

/**
 * Re-exposes window.localStorage under Node 22+.
 *
 * Vitest's jsdom environment maps `window` onto the Node global and
 * copies jsdom's own properties across, but it skips any key that the
 * Node global already declares unless that key is on its own allow
 * list -- see getWindowKeys in vitest/dist. Node 22 added an
 * experimental `localStorage` global that reads as undefined without
 * --localstorage-file, so the real jsdom storage is skipped and
 * `window.localStorage` is undefined. Browsers are unaffected; this is
 * a test-environment gap only.
 *
 * A plain in-memory Storage stands in. Each test FILE gets a fresh
 * environment, so this isolates files from one another exactly as
 * jsdom would, and leaves tests inside a file to clear it themselves.
 *
 * sessionStorage is deliberately left alone: tokenStorage.ts guards
 * every access, and giving it working storage would change how tests
 * that sign in behave.
 */
if (typeof window.localStorage === 'undefined') {
  const store = new Map<string, string>();

  const storage: Storage = {
    get length() {
      return store.size;
    },
    key: (index) => [...store.keys()][index] ?? null,
    getItem: (key) => store.get(String(key)) ?? null,
    setItem: (key, value) => void store.set(String(key), String(value)),
    removeItem: (key) => void store.delete(String(key)),
    clear: () => store.clear(),
  };

  Object.defineProperty(window, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  });
}
