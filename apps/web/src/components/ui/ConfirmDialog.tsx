import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog';
import { Button } from './button';
import { Input } from './input';

// #406 — Geri-alınamaz/tehlikeli aksiyonlar için yeniden-kullanılabilir teyit
// dialog'u (mevcut Radix Dialog üstüne; ayrı alert-dialog paketi gerekmez).
// Tek-tık destructive aksiyonları (iptal, gelmedi, onay/red, silme) sarar.
// Yüksek-risk (hasta/iade/kalıcı silme) → `confirmPhrase` ile type-to-confirm.
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  variant = 'destructive',
  pending = false,
  confirmPhrase,
  promptValue,
  onPromptChange,
  promptLabel,
  promptPlaceholder,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'destructive' | 'default';
  pending?: boolean;
  /**
   * Set edildiğinde "yaz-onayla" girişi gösterilir; confirm butonu yazılan
   * değer tam eşleşene kadar disabled kalır. Esc ile kapanmaz (kazara kapanma
   * engeli). Yüksek-risk aksiyonlar için (hasta sil, iade, kalıcı silme).
   */
  confirmPhrase?: string;
  /**
   * Serbest-metin giriş alanı (native `window.prompt()` yerine — bkz.
   * `hooks/useConfirm`'in `promptText`'i). `confirmPhrase`'ten farklı: tam
   * eşleşme gerektirmez, girilen değeri döndürür; confirm butonunu kilitlemez.
   */
  promptValue?: string;
  onPromptChange?: (value: string) => void;
  promptLabel?: string;
  promptPlaceholder?: string;
  onConfirm: () => void;
}) {
  const { t } = useTranslation('common');
  const [typed, setTyped] = useState('');

  // Dialog her açılışta/kapanışta yazılan değeri sıfırla (kalıntı eşleşme yok).
  useEffect(() => {
    if (!open) setTyped('');
  }, [open]);

  const phraseRequired = Boolean(confirmPhrase);
  const phraseSatisfied = !phraseRequired || typed === confirmPhrase;
  const showPrompt = onPromptChange !== undefined;
  const confirmDisabled = pending || !phraseSatisfied;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-sm"
        role="alertdialog"
        // Yüksek-risk: Esc ile kazara kapanma engeli (yalnız buton ile çıkış).
        onEscapeKeyDown={phraseRequired ? (e) => e.preventDefault() : undefined}
      >
        <DialogTitle>{title}</DialogTitle>
        {description && <DialogDescription className="mt-1">{description}</DialogDescription>}

        {phraseRequired && (
          <div className="mt-4 space-y-1.5">
            <label htmlFor="confirm-phrase" className="block text-[13px] font-semibold">
              Onaylamak için <b>{confirmPhrase}</b> yazın
            </label>
            <Input
              id="confirm-phrase"
              value={typed}
              autoComplete="off"
              onChange={(e) => setTyped(e.target.value)}
            />
          </div>
        )}

        {showPrompt && (
          <div className="mt-4 space-y-1.5">
            {promptLabel && (
              <label htmlFor="confirm-prompt-input" className="block text-[13px] font-semibold">
                {promptLabel}
              </label>
            )}
            <Input
              id="confirm-prompt-input"
              value={promptValue ?? ''}
              autoComplete="off"
              autoFocus
              placeholder={promptPlaceholder}
              onChange={(e) => onPromptChange?.(e.target.value)}
            />
          </div>
        )}

        {/* Cancel SOLDA (destructive'te ilk focus) · confirm SAĞDA. */}
        <div className="mt-5 flex justify-end gap-2">
          <Button
            variant="outline"
            size="touch"
            autoFocus={variant === 'destructive'}
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            {cancelLabel ?? t('actions.cancel')}
          </Button>
          <Button variant={variant} size="touch" onClick={onConfirm} disabled={confirmDisabled}>
            {confirmLabel ?? t('actions.delete')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
