import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getReceiptAutoprintMode,
  openReceiptPdf,
  printReceipt,
  setReceiptAutoprintMode,
} from './receipt-prefs';
import { api } from './api';

vi.mock('./api', () => ({ api: { get: vi.fn() } }));

const mockedGet = vi.mocked(api.get);

describe('receipt-prefs', () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockedGet.mockReset();
    mockedGet.mockResolvedValue({
      data: new Blob(['pdf'], { type: 'application/pdf' }),
    } as never);
    // jsdom URL.createObjectURL implemente etmez — testte stub'la.
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => 'blob:mock');
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('varsayılan modu auto döner', () => {
    expect(getReceiptAutoprintMode()).toBe('auto');
  });

  it('manual seçimini saklar ve geri okur', () => {
    setReceiptAutoprintMode('manual');
    expect(getReceiptAutoprintMode()).toBe('manual');
    setReceiptAutoprintMode('auto');
    expect(getReceiptAutoprintMode()).toBe('auto');
  });

  it('localStorage geçersiz değer içerirse auto döner', () => {
    window.localStorage.setItem('reception.receiptAutoprint', 'xxx');
    expect(getReceiptAutoprintMode()).toBe('auto');
  });

  it('printReceipt makbuzu authlu api ile blob olarak çeker ve iframe ekler', async () => {
    await printReceipt('inv-1');
    expect(mockedGet).toHaveBeenCalledWith('/billing/invoices/inv-1/receipt.pdf', {
      responseType: 'blob',
    });
    expect(document.querySelector('iframe')).not.toBeNull();
  });

  it('openReceiptPdf yeni sekme açar ve makbuzu authlu api ile blob olarak çeker', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue({ location: { href: '' } } as Window);
    openReceiptPdf('inv-2');
    expect(open).toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(mockedGet).toHaveBeenCalledWith('/billing/invoices/inv-2/receipt.pdf', {
        responseType: 'blob',
      }),
    );
  });
});
