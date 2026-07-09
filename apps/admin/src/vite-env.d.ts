/// <reference types="vite/client" />

// Build sırasında Vite `define` ile enjekte edilir (apps/admin/vite.config.ts) —
// GlitchTip/Sentry release etiketi: deploy edilen git SHA (APP_RELEASE env),
// yoksa package.json sürümüne düşer. lib/sentry.ts bunu `release` olarak kullanır.
declare const __APP_RELEASE__: string;
