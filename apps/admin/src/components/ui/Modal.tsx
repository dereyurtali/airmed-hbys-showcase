import { useEffect, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Yüksek-riskte Esc kapatmaz (Bölüm 24.4). */
  dismissable?: boolean;
  className?: string;
  children: ReactNode;
  testId?: string;
  labelledBy?: string;
}

/** Yüzen yüzey kabuğu — scrim rgba(15,23,42,.45) (blur yok), panel r8 + gölge + motion. */
export function Modal({
  open,
  onClose,
  dismissable = true,
  className,
  children,
  testId,
  labelledBy,
}: Props) {
  useEffect(() => {
    if (!open || !dismissable) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, dismissable, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(15,23,42,.45)' }}
      onClick={(e) => {
        if (dismissable && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        data-testid={testId}
        className={cn(
          'motion-pop shadow-float w-full max-w-md rounded-lg border border-border bg-background p-5',
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
