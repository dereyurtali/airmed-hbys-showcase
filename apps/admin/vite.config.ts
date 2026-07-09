import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { sentryVitePlugin } from '@sentry/vite-plugin';

// #943/#926 — Release etiketi = deploy edilen git SHA (APP_RELEASE), yoksa paket
// sürümü. lib/sentry.ts bunu `release` (__APP_RELEASE__) olarak kullanır.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
  version: string;
};
const APP_RELEASE = process.env.APP_RELEASE || pkg.version;

// Source map yükleme YALNIZ auth token verilince aktif (GlitchTip kurulunca).
// Token yoksa plugin dormant → maps üretilmez, hiçbir şey sızmaz.
const SENTRY_AUTH_TOKEN = process.env.SENTRY_AUTH_TOKEN;
const sourcemapUpload = Boolean(SENTRY_AUTH_TOKEN);

export default defineConfig({
  build: {
    sourcemap: sourcemapUpload ? 'hidden' : false,
    rollupOptions: {
      output: {
        // #1068 — stabil vendor'ları app kodundan ayır (web #1056 deseni):
        // dep bump entry cache'ini patlatmasın.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@sentry')) return 'vendor-sentry';
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'vendor-react';
          if (id.includes('react-router')) return 'vendor-router';
          if (id.includes('@tanstack')) return 'vendor-query';
          return undefined;
        },
      },
    },
  },
  plugins: [
    react(),
    sentryVitePlugin({
      disable: !sourcemapUpload,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: SENTRY_AUTH_TOKEN,
      url: process.env.SENTRY_URL,
      telemetry: false,
      release: { name: APP_RELEASE },
      sourcemaps: { filesToDeleteAfterUpload: ['**/*.map'] },
    }),
  ],
  define: {
    __APP_RELEASE__: JSON.stringify(APP_RELEASE),
  },
  server: {
    port: 5174,
    proxy: {
      '/platform': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
