import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const { toastFn } = vi.hoisted(() => ({ toastFn: vi.fn() }));
vi.mock('sonner', () => ({
  toast: Object.assign(toastFn, { success: vi.fn(), error: vi.fn() }),
}));

import { ConfirmDestructive } from './ConfirmDestructive';

describe('ConfirmDestructive', () => {
  beforeEach(() => {
    toastFn.mockReset();
  });

  it('doğru ifade yazılmadan onayla disabled (type-to-confirm)', () => {
    render(
      <ConfirmDestructive
        open
        onOpenChange={vi.fn()}
        title="Hasta sil"
        confirmPhrase="SİL"
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByTestId('confirm-destructive-submit')).toBeDisabled();
    fireEvent.change(screen.getByTestId('confirm-destructive-input'), { target: { value: 'SİL' } });
    expect(screen.getByTestId('confirm-destructive-submit')).toBeEnabled();
  });

  it('onConfirm reason ile çağrılır ve başarı sonrası undo toast atılır', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const onUndo = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <ConfirmDestructive
        open
        onOpenChange={onOpenChange}
        title="Kaydı sil"
        confirmPhrase="SİL"
        reasonRequired
        reasonMinLength={5}
        onConfirm={onConfirm}
        undoToast={{ message: 'Silindi', onUndo }}
      />,
    );
    // reason eksikken disabled
    fireEvent.change(screen.getByTestId('confirm-destructive-input'), { target: { value: 'SİL' } });
    expect(screen.getByTestId('confirm-destructive-submit')).toBeDisabled();
    fireEvent.change(screen.getByTestId('confirm-destructive-reason'), {
      target: { value: 'sebep yeterli' },
    });
    fireEvent.click(screen.getByTestId('confirm-destructive-submit'));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith({ reason: 'sebep yeterli' }));
    await waitFor(() => expect(toastFn).toHaveBeenCalled());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('requirePhrase=false ise yazma istemeden onaylanabilir', () => {
    render(
      <ConfirmDestructive
        open
        onOpenChange={vi.fn()}
        title="İptal et"
        requirePhrase={false}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('confirm-destructive-input')).not.toBeInTheDocument();
    expect(screen.getByTestId('confirm-destructive-submit')).toBeEnabled();
  });
});
