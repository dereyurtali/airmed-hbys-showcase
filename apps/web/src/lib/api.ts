import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';

// Same-origin default: prod/staging web Caddy arkasından sunulur (`/api/*` → api:3001);
// dev'de Vite proxy `/api`'yi :3001'e taşır. Mutlak localhost yazılırsa bundle'a gömülüp
// tarayıcının KENDİ makinesine istek atar (setup/login kırılır) — bu yüzden relative.
const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';

export const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

let accessToken: string | null = null;

export const setAccessToken = (token: string | null) => {
  accessToken = token;
};

export const getAccessToken = () => accessToken;

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

/**
 * Routes that must NOT trigger the 401 → /auth/refresh → retry loop. /refresh
 * itself is the obvious one (otherwise an expired refresh would recurse). The
 * other auth endpoints either set or clear the cookie themselves and a 401 on
 * them is a real failure to surface.
 */
const REFRESH_LOOP_GUARD = /\/auth\/(login|refresh|logout|change-password)\b/;

interface RetryableConfig extends InternalAxiosRequestConfig {
  _retried?: boolean;
}

let inflightRefresh: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  // Coalesce parallel refreshes so 5 simultaneous expired requests issue a
  // single /refresh round trip.
  if (!inflightRefresh) {
    inflightRefresh = api
      .post<{ accessToken: string }>('/auth/refresh')
      .then((res) => {
        setAccessToken(res.data.accessToken);
        return res.data.accessToken;
      })
      .catch(() => {
        setAccessToken(null);
        return null;
      })
      .finally(() => {
        inflightRefresh = null;
      });
  }
  return inflightRefresh;
}

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const config = error.config as RetryableConfig | undefined;
    if (
      !config ||
      error.response?.status !== 401 ||
      config._retried ||
      (config.url && REFRESH_LOOP_GUARD.test(config.url))
    ) {
      return Promise.reject(error);
    }

    config._retried = true;
    const fresh = await refreshAccessToken();
    if (!fresh) return Promise.reject(error);

    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${fresh}`;
    return api.request(config);
  },
);

export interface ApiErrorBody {
  message?: string | string[];
  error?: string;
  statusCode?: number;
}

export function readApiError(err: unknown): string {
  if (err instanceof AxiosError) {
    const data = err.response?.data as ApiErrorBody | undefined;
    if (data?.message) return Array.isArray(data.message) ? data.message[0] : data.message;
    return err.message;
  }
  return 'Beklenmeyen hata';
}
