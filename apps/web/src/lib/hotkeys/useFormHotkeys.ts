import { useEffect, useRef } from 'react';
import { hasMod } from './dom';

/**
 * Form klavye kısayolları — `Cmd/Ctrl+Enter` gönder · `Esc` iptal.
 * Cmd+Enter form alanlarında DA tetiklenir (kullanıcı input'ta yazarken bitirir).
 * Esc çoğu Radix Dialog tarafından native handle edilir; dialog-dışı formlarda bu hook gerekir.
 */
interface UseFormHotkeysOptions {
  onSubmit?: () => void;
  onCancel?: () => void;
  enabled?: boolean;
}

export function useFormHotkeys({ onSubmit, onCancel, enabled = true }: UseFormHotkeysOptions) {
  const ref = useRef({ onSubmit, onCancel });
  ref.current = { onSubmit, onCancel };

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && hasMod(e)) {
        e.preventDefault();
        ref.current.onSubmit?.();
      } else if (e.key === 'Escape') {
        ref.current.onCancel?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
