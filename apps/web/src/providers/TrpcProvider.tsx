import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import { getAccessToken } from '../lib/api';
import { queryClient } from '../lib/queryClient';
import { trpc } from '../lib/trpc';

// Same-origin relative (bkz. lib/api.ts notu): default `/api` → `/api/trpc`.
const TRPC_URL =
  ((import.meta.env.VITE_API_URL as string | undefined) ?? '/api').replace(/\/api\/?$/, '') +
  '/api/trpc';

export function TrpcProvider({ children }: { children: ReactNode }) {
  const trpcClient = useMemo(
    () =>
      trpc.createClient({
        links: [
          httpBatchLink({
            url: TRPC_URL,
            fetch: (url, init) => fetch(url, { ...init, credentials: 'include' }),
            headers: () => {
              const token = getAccessToken();
              return token ? { authorization: `Bearer ${token}` } : {};
            },
          }),
        ],
      }),
    [],
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
