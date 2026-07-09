import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { hasMod, isFormField, isTextArea } from './dom';

/**
 * Liste klavye-navigasyonu (Linear/Stripe tarzı) — kuyruk/tablo ekranları için.
 * `j`/`↓` sonraki · `k`/`↑` önceki · `Enter` seçili kaydı aç · `Esc` iptal · `/` aramaya odak.
 *
 * Kurallar: `j`/`k`/`/` form alanında (arama yazarken) tetiklenmez; `↑`/`↓` her zaman çalışır;
 * `Enter` textarea dışında seçer (tek-satır arama input'unda da seçer). Bağımlılık-bağımsız.
 */
interface UseListHotkeysOptions {
  count: number;
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  onSelect?: (index: number) => void;
  onEscape?: () => void;
  /** `/` basılınca odaklanacak arama input'u. */
  searchRef?: RefObject<HTMLInputElement | null>;
  enabled?: boolean;
}

export function useListHotkeys({
  count,
  activeIndex,
  setActiveIndex,
  onSelect,
  onEscape,
  searchRef,
  enabled = true,
}: UseListHotkeysOptions) {
  const ref = useRef({ count, activeIndex, setActiveIndex, onSelect, onEscape, searchRef });
  ref.current = { count, activeIndex, setActiveIndex, onSelect, onEscape, searchRef };

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const s = ref.current;
      if (s.count <= 0 && e.key !== 'Escape' && e.key !== '/') return;
      const inField = isFormField(e.target);
      const clamp = (i: number) => Math.max(0, Math.min(s.count - 1, i));

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          s.setActiveIndex(clamp(s.activeIndex + 1));
          break;
        case 'j':
          if (inField || hasMod(e)) return;
          e.preventDefault();
          s.setActiveIndex(clamp(s.activeIndex + 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          s.setActiveIndex(clamp(s.activeIndex - 1));
          break;
        case 'k':
          if (inField || hasMod(e)) return;
          e.preventDefault();
          s.setActiveIndex(clamp(s.activeIndex - 1));
          break;
        case 'Enter':
          if (isTextArea(e.target) || hasMod(e)) return;
          if (s.activeIndex >= 0 && s.activeIndex < s.count) {
            e.preventDefault();
            s.onSelect?.(s.activeIndex);
          }
          break;
        case 'Escape':
          s.onEscape?.();
          break;
        case '/':
          if (inField) return;
          if (s.searchRef?.current) {
            e.preventDefault();
            s.searchRef.current.focus();
          }
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
