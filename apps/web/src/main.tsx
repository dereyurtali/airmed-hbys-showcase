import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initSentry } from './lib/sentry';
import './index.css';
import { initI18n } from './i18n';

// VITE_SENTRY_DSN set ise frontend hata izlemeyi başlat (yoksa dormant).
initSentry();

// #1056 — aktif dil RU/TG ise locale chunk'ı ilk render'dan önce yüklenir
// (TR bundled, anında çözülür). Yükleme hata verirse TR fallback ile render.
void initI18n()
  .catch(() => undefined)
  .then(() => {
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  });
