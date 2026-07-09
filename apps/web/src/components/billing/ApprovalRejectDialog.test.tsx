import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import { ApprovalRejectDialog } from './ApprovalRejectDialog';

describe('ApprovalRejectDialog', () => {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();

  beforeEach(() => {
    onConfirm.mockReset();
    onOpenChange.mockReset();
  });

  function setup(open = true) {
    return render(
      <ApprovalRejectDialog open={open} onOpenChange={onOpenChange} onConfirm={onConfirm} />,
    );
  }

  it('açıkken gerekçe alanı + reddet butonu görünür', () => {
    setup();
    expect(screen.getByText('approvalReject.title')).toBeInTheDocument();
    expect(screen.getByLabelText('approvalReject.reasonLabel')).toBeInTheDocument();
    expect(screen.getByText('approvalReject.confirm')).toBeInTheDocument();
  });

  it('gerekçe girilip onaylanınca onConfirm(reason) çağrılır', () => {
    setup();
    fireEvent.change(screen.getByLabelText('approvalReject.reasonLabel'), {
      target: { value: '  fiyat fazla  ' },
    });
    fireEvent.click(screen.getByText('approvalReject.confirm'));
    expect(onConfirm).toHaveBeenCalledWith('fiyat fazla');
  });

  it('gerekçe boşken onConfirm(null) ile çağrılır (opsiyonel)', () => {
    setup();
    fireEvent.click(screen.getByText('approvalReject.confirm'));
    expect(onConfirm).toHaveBeenCalledWith(null);
  });

  it('iptal → onOpenChange(false)', () => {
    setup();
    fireEvent.click(screen.getByText('actions.cancel'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('pending iken butonlar disabled', () => {
    render(<ApprovalRejectDialog open pending onOpenChange={onOpenChange} onConfirm={onConfirm} />);
    expect(screen.getByText('approvalReject.confirm').closest('button')).toBeDisabled();
  });
});
