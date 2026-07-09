import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { sentryVitePlugin } from '@sentry/vite-plugin';

// Paralel worktree session'ları farklı port'larda API çalıştırabilir
// (CLAUDE.md "Paralel Claude Session Disiplini"). VITE_PORT + API_TARGET
// env var'ları ile aynı vite.config.ts dosyasını yeniden kullanırız.
const VITE_PORT = Number(process.env.VITE_PORT ?? 5173);
const API_TARGET = process.env.API_TARGET ?? 'http://localhost:3001';

// Sürüm tek kaynak = package.json. Build-time enjekte edilir (lib/version.ts
// `__APP_VERSION__` okur) → UI sürümü elle güncellenmez; bump otomatik yansır.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
  version: string;
};

// Release etiketi = deploy edilen git SHA (APP_RELEASE), yoksa paket sürümü.
// FE Sentry init bunu `release` olarak kullanır; yüklenen source map'ler bu
// release'e bağlanır → GlitchTip'te okunabilir stack.
const APP_RELEASE = process.env.APP_RELEASE || pkg.version;

// Source map yükleme YALNIZ auth token verilince aktif (GlitchTip kurulunca,
// I1.4 + deploy). Token yoksa plugin dormant → maps üretilmez, hiçbir şey sızmaz.
const SENTRY_AUTH_TOKEN = process.env.SENTRY_AUTH_TOKEN;
const sourcemapUpload = Boolean(SENTRY_AUTH_TOKEN);

export default defineConfig({
  // Source map yalnız GlitchTip'e yüklendiğinde üretilir; 'hidden' = bundle'a
  // `sourceMappingURL` yorumu EKLENMEZ (public'e sızmaz), plugin yükleyip siler.
  build: {
    sourcemap: sourcemapUpload ? 'hidden' : false,
    rollupOptions: {
      output: {
        // #1056 — stabil vendor'ları app shell'den ayır: tek dep bump'ı 1.3MB
        // monolitik entry'nin cache'ini patlatmasın; düşük güçlü klinik PC'leri
        // her deploy'da yalnız değişen chunk'ı indirip parse etsin.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (/node_modules\/(recharts|victory-vendor|d3-)/.test(id)) return 'vendor-charts';
          if (id.includes('@sentry')) return 'vendor-sentry';
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'vendor-react';
          if (id.includes('react-router')) return 'vendor-router';
          if (id.includes('@tanstack') || id.includes('@trpc')) return 'vendor-data';
          if (id.includes('i18next')) return 'vendor-i18n';
          if (id.includes('@radix-ui') || id.includes('lucide-react') || id.includes('cmdk'))
            return 'vendor-ui';
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
      // Self-hosted GlitchTip endpoint'i (sentry.io değil).
      url: process.env.SENTRY_URL,
      telemetry: false,
      release: { name: APP_RELEASE },
      // Yükleme sonrası .map dosyalarını sil → dist/docker image'ına sızmaz.
      sourcemaps: { filesToDeleteAfterUpload: ['**/*.map'] },
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_RELEASE__: JSON.stringify(APP_RELEASE),
  },
  server: {
    port: VITE_PORT,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    exclude: ['node_modules', 'dist', 'e2e/**', 'test-results/**', 'playwright-report/**'],
  },
});
