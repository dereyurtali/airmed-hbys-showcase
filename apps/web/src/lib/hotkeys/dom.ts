/**
 * Klavye katmanı yardımcıları — v0.4.2 G3 (#722). Bağımlılık-bağımsız (react-hotkeys-hook
 * yerine): mevcut GlobalPatientSearch keydown idiomuyla uyumlu, tRPC/react-query sürüm
 * hassasiyeti + lockfile churn riski yok. R1-R9'un klavye-first akışlarının önkoşulu.
 */

/** input/textarea/select/contenteditable — bunlarda yazarken kısayol tetikleme. */
export function isFormField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/** Çok satırlı alan — Enter burada yeni satırdır, "onayla" değil. */
export function isTextArea(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.tagName === 'TEXTAREA';
}

/** Cmd (mac) veya Ctrl (win/linux). */
export function hasMod(e: KeyboardEvent): boolean {
  return e.metaKey || e.ctrlKey;
}
