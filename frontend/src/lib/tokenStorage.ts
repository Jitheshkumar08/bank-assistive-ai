const STORAGE_KEY = 'bank-assistant.access-token';

/**
 * Where the access token lives between page loads.
 *
 * sessionStorage, not localStorage: this app is used on shared devices
 * in a branch, and a token that survives closing the tab would leave
 * the next person holding the phone signed in as someone else.
 *
 * Both are readable by any script on the origin, so neither is proof
 * against XSS. The production answer is an httpOnly, SameSite cookie
 * issued by the API -- that requires a backend change and is a
 * deliberate follow-up, not an oversight.
 *
 * Every access is guarded: Safari's private mode and hardened browser
 * settings make these calls throw rather than return null.
 */
export const tokenStorage = {
  read(): string | null {
    try {
      return sessionStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  },

  write(token: string): void {
    try {
      sessionStorage.setItem(STORAGE_KEY, token);
    } catch {
      // Storage unavailable. The token stays in memory for this page
      // load, so the session still works until a refresh.
    }
  },

  clear(): void {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing to do; the in-memory token is cleared regardless.
    }
  },
};
