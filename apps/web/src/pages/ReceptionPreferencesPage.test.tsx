import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ReceptionPreferencesPage } from './ReceptionPreferencesPage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

describe('ReceptionPreferencesPage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('auto modu varsayılan seçili', () => {
    render(<ReceptionPreferencesPage />);
    const autoRadio = screen.getByTestId('receipt-mode-auto') as HTMLInputElement;
    const manualRadio = screen.getByTestId('receipt-mode-manual') as HTMLInputElement;
    expect(autoRadio.checked).toBe(true);
    expect(manualRadio.checked).toBe(false);
  });

  it('manual seçince localStorage güncellenir', () => {
    render(<ReceptionPreferencesPage />);
    fireEvent.click(screen.getByTestId('receipt-mode-manual'));
    expect(window.localStorage.getItem('reception.receiptAutoprint')).toBe('manual');
    expect((screen.getByTestId('receipt-mode-manual') as HTMLInputElement).checked).toBe(true);
  });
});
