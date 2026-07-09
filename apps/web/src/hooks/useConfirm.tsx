import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

interface PromptOptions {
  title?: string;
  message: string;
  placeholder?: string;
  confirmLabel?: string;
}

interface ConfirmContextValue {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  promptText: (options: PromptOptions) => Promise<string | null>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

type PendingRequest =
  | { kind: 'confirm'; options: ConfirmOptions; resolve: (value: boolean) => void }
  | { kind: 'prompt'; options: PromptOptions; resolve: (value: string | null) => void };

/**
 * airmed-design Ray 3 — native `window.confirm`/`window.prompt` yasak (klinik
 * ortamda native tarayıcı dialogu marka/erişilebilirlik dışı ve test edilemez).
 * Bu provider imperative bir `confirm()`/`promptText()` sunar; native API'yi
 * taklit eder ki migration minimal kalsın:
 *   `if (!window.confirm(msg)) return;` → `if (!(await confirm({ message: msg }))) return;`
 *   `const v = window.prompt(msg);`      → `const v = await promptText({ message: msg });`
 * Tek dialog instance'ı — aynı anda yalnız bir confirm/prompt açık olabilir
 * (native davranışla aynı; klinik akışlarında zaten sıralı kullanılıyor).
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation('common');
  const [request, setRequest] = useState<PendingRequest | null>(null);
  const [promptValue, setPromptValue] = useState('');

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setRequest({ kind: 'confirm', options, resolve });
    });
  }, []);

  const promptText = useCallback((options: PromptOptions) => {
    setPromptValue('');
    return new Promise<string | null>((resolve) => {
      setRequest({ kind: 'prompt', options, resolve });
    });
  }, []);

  const settle = useCallback(
    (value: boolean | string | null) => {
      if (!request) return;
      if (request.kind === 'confirm') {
        request.resolve(Boolean(value));
      } else {
        request.resolve(typeof value === 'string' ? value : null);
      }
      setRequest(null);
    },
    [request],
  );

  const value = useMemo<ConfirmContextValue>(
    () => ({ confirm, promptText }),
    [confirm, promptText],
  );

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {request && (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) settle(request.kind === 'confirm' ? false : null);
          }}
          title={
            request.options.title ??
            (request.kind === 'confirm' ? t('confirm.title') : t('confirm.promptTitle'))
          }
          description={request.options.message}
          confirmLabel={
            request.options.confirmLabel ??
            (request.kind === 'confirm'
              ? t('confirm.confirmLabel')
              : t('confirm.promptConfirmLabel'))
          }
          cancelLabel={request.kind === 'confirm' ? request.options.cancelLabel : undefined}
          variant={
            request.kind === 'confirm' && request.options.destructive ? 'destructive' : 'default'
          }
          onConfirm={() => settle(request.kind === 'confirm' ? true : promptValue)}
          {...(request.kind === 'prompt'
            ? {
                promptValue,
                onPromptChange: setPromptValue,
                promptPlaceholder: request.options.placeholder,
              }
            : {})}
        />
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within a ConfirmProvider');
  return ctx;
}
