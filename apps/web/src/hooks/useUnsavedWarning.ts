import { useEffect } from 'react';

// SİS-8 — Kaydedilmemiş form değişikliği koruması. Uygulama BrowserRouter
// (data router değil) kullandığından react-router `useBlocker` mevcut değil;
// bu hook tarayıcı seviyesinde (sekme kapat / yenile / geri) `beforeunload`
// uyarısı verir. Dialog/in-app kapatma teyidi `confirmIfDirty` ile ayrıca
// yapılır (bkz. forms.unsavedConfirm).
export function useUnsavedWarning(when: boolean): void {
  useEffect(() => {
    if (!when) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Modern tarayıcılar özel metni göstermez; returnValue set etmek
      // yerleşik "değişiklikler kaybolabilir" uyarısını tetikler.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [when]);
}

/**
 * Dialog/in-app kapatma teyidi. `dirty` ise kullanıcıya onay sorar; iptal
 * ederse `false` döner (kapatma engellenmeli). Mesaj çağıran taraftan
 * (t('common:forms.unsavedConfirm')) verilir.
 */
export function confirmIfDirty(dirty: boolean, message: string): boolean {
  if (!dirty) return true;
  return window.confirm(message);
}
