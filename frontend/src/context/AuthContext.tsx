import { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { authApi } from '@/api/auth.api';
import { setTokenReader, setUnauthorizedHandler } from '@/api/client';
import { tokenStorage } from '@/lib/tokenStorage';
import { ApiError } from '@/types/api';
import type {
  AuthenticatedUser,
  ChangePasswordRequest,
  LoginRequest,
  RegisterRequest,
  UpdateProfileRequest,
} from '@/types/auth';

export interface AuthContextValue {
  user: AuthenticatedUser | null;
  isAuthenticated: boolean;
  /** True while a stored token is being checked on first load. */
  isRestoring: boolean;
  /** Resolves with the account, so a caller can route by its role. */
  login: (credentials: LoginRequest) => Promise<AuthenticatedUser>;
  /** Creates the account and signs straight in, as login does. */
  register: (details: RegisterRequest) => Promise<void>;
  /** Applies account changes and adopts the refreshed token. */
  updateProfile: (changes: UpdateProfileRequest) => Promise<void>;
  changePassword: (change: ChangePasswordRequest) => Promise<void>;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);

  // The token is held in a ref as well as storage so the API client can
  // read it synchronously, without a re-render between sign-in and the
  // next request.
  const tokenRef = useRef<string | null>(tokenStorage.read());

  const logout = useCallback((): void => {
    tokenRef.current = null;
    tokenStorage.clear();
    setUser(null);
  }, []);

  // Installed once, before any request can run. The client stays free of
  // React state; it just asks these two functions.
  useEffect(() => {
    setTokenReader(() => tokenRef.current);
    setUnauthorizedHandler(logout);
  }, [logout]);

  // On first load, a stored token is only trusted after the API confirms
  // it. That way a revoked or expired token signs the user out here
  // rather than failing on their first real action.
  useEffect(() => {
    const controller = new AbortController();

    async function restore(): Promise<void> {
      if (!tokenRef.current) {
        setIsRestoring(false);
        return;
      }

      try {
        setUser(await authApi.me(controller.signal));
      } catch (error) {
        // A rejected token is expected here and already cleared by the
        // unauthorized handler. A network failure is not: keep the token
        // so a brief outage does not force a fresh sign-in.
        if (error instanceof ApiError && !error.isNetworkError) {
          logout();
        }
      } finally {
        setIsRestoring(false);
      }
    }

    void restore();

    return () => controller.abort();
  }, [logout]);

  /** Everything that makes a session real, in one place. */
  const adopt = useCallback((result: { accessToken: string; user: AuthenticatedUser }): void => {
    tokenRef.current = result.accessToken;
    tokenStorage.write(result.accessToken);
    setUser(result.user);
  }, []);

  const login = useCallback(
    async (credentials: LoginRequest): Promise<AuthenticatedUser> => {
      const result = await authApi.login(credentials);
      adopt(result);

      return result.user;
    },
    [adopt],
  );

  // Registering signs the customer in immediately. Asking someone to
  // type the password they just chose, while standing at a counter,
  // would be a needless second hurdle.
  const register = useCallback(
    async (details: RegisterRequest): Promise<void> => {
      adopt(await authApi.register(details));
    },
    [adopt],
  );

  // Both of these return a fresh token: changing an email changes what
  // the old token claims, and changing a password is a moment to stop
  // carrying the token that was issued before it.
  const updateProfile = useCallback(
    async (changes: UpdateProfileRequest): Promise<void> => {
      adopt(await authApi.updateProfile(changes));
    },
    [adopt],
  );

  const changePassword = useCallback(
    async (change: ChangePasswordRequest): Promise<void> => {
      adopt(await authApi.changePassword(change));
    },
    [adopt],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: user !== null,
      isRestoring,
      login,
      register,
      updateProfile,
      changePassword,
      logout,
    }),
    [user, isRestoring, login, register, updateProfile, changePassword, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
