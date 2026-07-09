import { Modal } from './Modal';
import { Button } from './Button';

interface Props {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel: string;
  tone?: 'danger' | 'primary';
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  testId?: string;
  confirmTestId?: string;
}

/**
 * Onay / yıkıcı dialog (airmed-design Ray 3 + Bölüm 24.4). Native confirm() yerine.
 * Vazgeç solda, onay sağda; yıkıcı = critical buton.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone = 'danger',
  busy = false,
  onConfirm,
  onClose,
  testId,
  confirmTestId,
}: Props) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissable={!busy}
      testId={testId}
      labelledBy="confirm-title"
    >
      <h2 id="confirm-title" className="text-[15px] font-semibold text-foreground">
        {title}
      </h2>
      {description && <p className="mt-2 text-[13px] text-muted-foreground">{description}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          {cancelLabel}
        </Button>
        <Button
          variant={tone === 'danger' ? 'danger' : 'primary'}
          onClick={onConfirm}
          loading={busy}
          data-testid={confirmTestId}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
