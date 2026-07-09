import { INVOICE_INCLUDE } from './invoice.service';

// #1140 — InvoiceDetailPage render'ının ihtiyaç duyduğu ilişkiler INVOICE_INCLUDE'da
// yüklü olmalı. Aksi halde ödemeli fatura detayı runtime'da çöker (p.takenBy.name).
// Bir select-narrowing PR bunları düşürürse test kırmızı → çöküş CI'da yakalanır.
describe('INVOICE_INCLUDE (#1140 fatura detay çöküş guard)', () => {
  const payments = INVOICE_INCLUDE.payments as {
    include: {
      takenBy?: unknown;
      refunds?: { include?: { approvedBy?: unknown } };
    };
  };

  it('payments.takenBy yüklü (sayfa p.takenBy.name render eder)', () => {
    expect(payments.include.takenBy).toBeDefined();
  });

  it('payments.refunds.approvedBy yüklü (sayfa r.approvedBy?.name render eder)', () => {
    expect(payments.include.refunds?.include?.approvedBy).toBeDefined();
  });

  it('items + patient yüklü', () => {
    expect(INVOICE_INCLUDE.items).toBeDefined();
    expect(INVOICE_INCLUDE.patient).toBeDefined();
  });
});
