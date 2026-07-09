/// <reference types="vite/client" />

// Build sırasında Vite `define` ile enjekte edilir (apps/web/vite.config.ts) —
// package.json sürümü. Bkz. lib/version.ts.
declare const __APP_VERSION__: string;

// GlitchTip/Sentry release etiketi — deploy edilen git SHA (APP_RELEASE env),
// yoksa package.json sürümüne düşer. Vite `define` ile enjekte (I1.3 #815).
declare const __APP_RELEASE__: string;
