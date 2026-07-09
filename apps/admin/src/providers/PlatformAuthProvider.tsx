import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { ApiError, api, setUnauthorizedHandler } from '../lib/api';
import type {
  LoginChallengeResponse,
  PlatformAdminPayload,
  SetupTotpResponse,
  VerifyTotpResponse,
} from '../lib/types';

/**
 * Platform auth state machine. Transitions:
 *   logged_out --login--> challenge
 *   challenge --setup-totp--> challenge (server now has secret) + recoveryCodes shown
 *   challenge --verify-totp--> authenticated
 *   authenticated --logout--> logged_out
 *
 * Access token lives in memory only — page reload drops it intentionally,
 * forcing a fresh login. Refresh cookie (httpOnly + Strict + path=/platform/auth)
 * does the long-lived persistence on the browser side.
 */
export type AuthState =
  | { status: 'logged_out' }
  | { status: 'bootstrapping' }
  | {
      status: 'challenge';
      challengeToken: string;
      needsTotpSetup: boolean;
      pendingRecoveryCodes?: string[];
      pendingOtpauthUrl?: string;
      pendingSecret?: string;
    }
  | { status: 'authenticated'; accessToken: string; admin: PlatformAdminPayload };

interface AuthContextValue {
  state: AuthState;
  login: (email: string, password: string) => Promise<void>;
  setupTotp: () => Promise<SetupTotpResponse>;
  verifyTotp: (input: { code?: string; recoveryCode?: string }) => Promise<void>;
  logout: () => Promise<void>;
  /** Used by API consumers (e.g. dashboard pages) to attach the bearer. */
  getAccessToken: () => string | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function PlatformAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'bootstrapping' });
  const accessTokenRef = useRef<string | null>(null);
  // Mirror state into a ref so async callbacks can read the latest snapshot
  // without stale-closure bugs. Internal only.
  const stateRef = useRef<AuthState>(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // #404 — Global 401 → oturum temizliği. Yalnızca authenticated bir oturumda
  // (access token expired) tetiklenir; login/refresh/challenge akışlarının
  // beklenen 401'leri görmezden gelinir. ProtectedShell logged_out'ta /login'e atar.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (stateRef.current.status !== 'authenticated') return;
      accessTokenRef.current = null;
      setState({ status: 'logged_out' });
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  // Bootstrap: try to mint an access token from the refresh cookie. If the
  // user already has a valid platform session, skip the login form.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api<{ accessToken: string }>('/platform/auth/refresh', { method: 'POST' });
        const me = await api<PlatformAdminPayload>('/platform/auth/me', { bearer: r.accessToken });
        if (!cancelled) {
          accessTokenRef.current = r.accessToken;
          setState({ status: 'authenticated', accessToken: r.accessToken, admin: me });
        }
      } catch {
        if (!cancelled) setState({ status: 'logged_out' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api<LoginChallengeResponse>('/platform/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    setState({
      status: 'challenge',
      challengeToken: r.challengeToken,
      needsTotpSetup: r.needsTotpSetup,
    });
  }, []);

  const setupTotp = useCallback(async (): Promise<SetupTotpResponse> => {
    const current = stateRef.current;
    if (current.status !== 'challenge') throw new Error('setupTotp called outside challenge state');
    const r = await api<SetupTotpResponse>('/platform/auth/setup-totp', {
      method: 'POST',
      bearer: current.challengeToken,
    });
    setState({
      status: 'challenge',
      challengeToken: current.challengeToken,
      needsTotpSetup: false,
      pendingRecoveryCodes: r.recoveryCodes,
      pendingOtpauthUrl: r.otpauthUrl,
      pendingSecret: r.secret,
    });
    return r;
  }, []);

  const verifyTotp = useCallback(async (input: { code?: string; recoveryCode?: string }) => {
    const current = stateRef.current;
    if (current.status !== 'challenge')
      throw new Error('verifyTotp called outside challenge state');
    const r = await api<VerifyTotpResponse>('/platform/auth/verify-totp', {
      method: 'POST',
      bearer: current.challengeToken,
      body: input,
    });
    const me = await api<PlatformAdminPayload>('/platform/auth/me', { bearer: r.accessToken });
    accessTokenRef.current = r.accessToken;
    setState({ status: 'authenticated', accessToken: r.accessToken, admin: me });
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('/platform/auth/logout', { method: 'POST' });
    } catch (err) {
      if (!(err instanceof ApiError) || err.status >= 500) {
        // Surface unexpected failures to logs; logout still proceeds locally.
        console.warn('platform logout failed:', err);
      }
    }
    accessTokenRef.current = null;
    setState({ status: 'logged_out' });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      login,
      setupTotp,
      verifyTotp,
      logout,
      getAccessToken: () => accessTokenRef.current,
    }),
    [state, login, setupTotp, verifyTotp, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function usePlatformAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('usePlatformAuth must be used inside PlatformAuthProvider');
  return ctx;
}
