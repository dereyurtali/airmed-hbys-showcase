import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { initSentry } from './lib/sentry';
import './styles/global.css';

// #943/#926 — DSN yoksa no-op; set ise GlitchTip'e (PII scrub'lı) event gider.
initSentry();

// #944 (F2) — React Query tek client. İç araç → makul default'lar: 30sn stale,
// focus'ta refetch yok, 1 retry.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
