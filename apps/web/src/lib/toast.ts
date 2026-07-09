import { toast as sonnerToast, type ExternalToast } from 'sonner';

// Bölüm 24 — toast yardımcıları. Süre ciddiyetle artar: bilgi kısa, hata uzun,
// klinik hata manuel kapatılır (sessizce kaybolmaz). `action` = "Geri al" gibi
// tek aksiyon (undo). Sonner'ın kendi `toast`'ını sarar; mevcut doğrudan
// `import { toast } from 'sonner'` kullanımları etkilenmez.

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  description?: string;
  action?: ToastAction;
}

const DURATIONS = {
  success: 4000,
  info: 6000,
  warning: 7000,
  error: 10000,
} as const;

function build(opts: ToastOptions | undefined, duration: number): ExternalToast {
  return {
    duration,
    description: opts?.description,
    action: opts?.action ? { label: opts.action.label, onClick: opts.action.onClick } : undefined,
  };
}

export const toast = {
  success: (message: string, opts?: ToastOptions) =>
    sonnerToast.success(message, build(opts, DURATIONS.success)),
  info: (message: string, opts?: ToastOptions) =>
    sonnerToast.info(message, build(opts, DURATIONS.info)),
  warning: (message: string, opts?: ToastOptions) =>
    sonnerToast.warning(message, build(opts, DURATIONS.warning)),
  error: (message: string, opts?: ToastOptions) =>
    sonnerToast.error(message, build(opts, DURATIONS.error)),
  /** Klinik hata: manuel kapatılana kadar kalır (Infinity) — kritik, kaçırılmamalı. */
  clinicalError: (message: string, opts?: ToastOptions) =>
    sonnerToast.error(message, build(opts, Number.POSITIVE_INFINITY)),
};
