import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api, setAccessToken } from '../lib/api';
import { queryClient } from '../lib/queryClient';

export interface AuthUser {
  /** JWT `sub` — User.id. S15b bildirim filtresi (recipientUserId === id). */
  id: string;
  email: string;
  tenantId: string;
  roles: string[];
  // PermissionAssignment runtime: JWT `effectivePerms` claim'i — backend
  // login/refresh sırasında registry + tenant override'larını birleştirip
  // gömer. `usePermission` önce buna bakar; undefined ise registry fallback.
  // Override değişiklikleri kullanıcının bir sonraki access token refresh'inde
  // yansır (~15 dk). Undefined olabilir: legacy token veya backend deploy
  // öncesi ele alınan kullanıcılar.
  effectivePerms?: string[];
  // v0.4 (#541) — JWT `mode` claim'i: oturumun çalışma modu (girişte seçilen).
  // Sidebar varyantı + açılış sayfası (HomeRedirect) buna göre değişir; kilitli
  // mod (olcum) kiosk sidebar'ı + tek-ekran landing verir. undefined = klasik.
  mode?: string;
  // v0.4 İP-7 (#543) — JWT `flags` claim'i: rol-üstü kalıcı kullanıcı bayrakları.
  // Doktor niteliği buradan okunur: `is_visiting_doctor` (Misafir) → dar sidebar +
  // klinik-geneli arama gizli; `can_see_all_patients` (baş hekim override). Hasta
  // verisi her hâlükârda backend'de gate'li (patient.service); bu alan yalnız UX
  // formalizasyonu (görünür kısıtlama). undefined = klasik (Yerleşik doktor).
  flags?: UserFlags;
  // F4 — impersonation context: JWT'de `imp` claim'i varsa dolu. Banner +
  // ImpersonationBanner komponentı bu alanı kontrol eder.
  impersonation: ImpersonationContext | null;
}

/** JWT `flags` claim — backend UserFlags (auth.types.ts) ile aynı şekil. */
export interface UserFlags {
  is_visiting_doctor?: boolean;
  can_see_all_patients?: boolean;
  modes?: string[];
}

export interface ImpersonationContext {
  id: string;
  by: string;
  byName: string;
  /** Token expiry — banner countdown timer için */
  expiresAt: Date;
}

interface RefreshResponse {
  accessToken: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  mustChangePassword: boolean;
  applyAuthState: (accessToken: string, mustChangePassword: boolean) => void;
  clearMustChangePassword: () => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function decodeJwt(token: string): AuthUser | null {
  try {
    const [, payload] = token.split('.');
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as {
      sub: string;
      email: string;
      tenantId: string;
      roles?: string[];
      effectivePerms?: string[];
      mode?: string;
      flags?: UserFlags;
      exp?: number;
      imp?: { id: string; by: string; byName: string };
    };
    const impersonation: ImpersonationContext | null = json.imp
      ? {
          id: json.imp.id,
          by: json.imp.by,
          byName: json.imp.byName,
          expiresAt: new Date((json.exp ?? 0) * 1000),
        }
      : null;
    return {
      id: json.sub,
      email: json.email,
      tenantId: json.tenantId,
      roles: json.roles ?? [],
      effectivePerms: json.effectivePerms,
      mode: json.mode,
      flags: json.flags,
      impersonation,
    };
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [mustChangePassword, setMustChangePassword] = useState(false);

  const applyAuthState = useCallback((accessToken: string, mustChange: boolean) => {
    const next = decodeJwt(accessToken);
    setAccessToken(accessToken);
    setUser((prev) => {
      // Farklı bir user'a geçiş → önceki user'ın react-query cache'i tutarsız
      // (auth.me, dashboard widget'ları, sidebar sayaçları yanlış kişiyi
      // gösterir). Aynı user'ın refresh akışında (mount'taki /auth/refresh)
      // prev null → clear çağrılmaz, mevcut cache korunur.
      if (prev && next && prev.id !== next.id) {
        queryClient.clear();
      }
      return next;
    });
    setMustChangePassword(mustChange);
  }, []);

  const clearAuth = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setMustChangePassword(false);
    // Logout: tüm cache silinir — sonraki user'ın login'i temiz state ile
    // başlar + önceki user'ın PHI/hasta verisi bellekte kalmaz.
    queryClient.clear();
  }, []);

  useEffect(() => {
    // StrictMode mounts the effect twice in development; abort the first
    // run so we never end up with two refresh requests racing.
    const controller = new AbortController();
    let cancelled = false;
    api
      .post<RefreshResponse>('/auth/refresh', undefined, { signal: controller.signal })
      .then((res) => {
        if (!cancelled) applyAuthState(res.data.accessToken, false);
      })
      .catch((err: unknown) => {
        if (!cancelled && !(err instanceof Error && err.name === 'CanceledError')) {
          clearAuth();
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [applyAuthState, clearAuth]);

  // #921 — 30 dk inaktivite → oturumu proaktif kapat (klinik walk-away koruması:
  // hekim/personel masadan ayrılınca ekran + cache boşalır, PHI ortada kalmaz).
  // Backend refresh idle-reject aynı eşiği server-side zorlar; bu UX katmanı.
  useEffect(() => {
    if (!user) return;
    const IDLE_MS = 30 * 60 * 1000;
    let timer: number;
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => clearAuth(), IDLE_MS);
    };
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'] as const;
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      window.clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [user, clearAuth]);

  const clearMustChangePassword = useCallback(() => {
    setMustChangePassword(false);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      clearAuth();
    }
  }, [clearAuth]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: !!user,
      isLoading,
      mustChangePassword,
      applyAuthState,
      clearMustChangePassword,
      logout,
    }),
    [user, isLoading, mustChangePassword, applyAuthState, clearMustChangePassword, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
