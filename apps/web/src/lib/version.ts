// Uygulama sürümü — build sırasında package.json'dan enjekte edilir (Vite
// `define: __APP_VERSION__`). Tek kaynak package.json'dur; sürüm i18n'de ya da
// elle güncellenen bir string'de DEĞİL. Bump yapılınca (örn. Z1 #732) UI otomatik
// güncel sürümü gösterir.
export const APP_VERSION = __APP_VERSION__;

// Gösterim etiketi — sürüm pill/footer için ("v0.4.1" gibi).
export const APP_VERSION_LABEL = `v${APP_VERSION}`;
