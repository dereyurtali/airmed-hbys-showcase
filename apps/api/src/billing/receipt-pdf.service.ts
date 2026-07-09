import { Injectable, NotFoundException } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// S11e — Makbuz PDF üretimi (pdfkit).
// Tek dosya, A5 layout, klinik logosu placeholder, hasta + kalemler + ödemeler.
// Vergisiz makbuz (karar 7 — pilot için yeterli).

@Injectable()
export class ReceiptPdfService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fatura ID için PDF makbuz buffer'ı üret.
   * Returns: { buffer, filename } — controller bunları Content-Disposition ile gönderir.
   */
  async generate(invoiceId: string): Promise<{ buffer: Buffer; filename: string }> {
    const invoice = await this.prisma.scoped.invoice.findFirst({
      where: { id: invoiceId, deletedAt: null },
      include: {
        items: { orderBy: { sortOrder: 'asc' } },
        payments: {
          where: { deletedAt: null },
          orderBy: { takenAt: 'asc' },
          include: {
            takenBy: { select: { name: true } },
            refunds: { include: { approvedBy: { select: { name: true } } } },
          },
        },
        patient: { select: { firstName: true, lastName: true, mrn: true, phone: true } },
        tenant: { select: { name: true } },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');

    const doc = new PDFDocument({
      size: 'A5',
      margins: { top: 30, bottom: 30, left: 30, right: 30 },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });

    // Header
    doc.fontSize(16).font('Helvetica-Bold').text(invoice.tenant.name, { align: 'center' });
    doc.fontSize(11).font('Helvetica').text('MAKBUZ', { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(9).fillColor('#666').text(`No: ${invoice.invoiceNumber}`, { align: 'center' });
    doc.fillColor('#000');
    doc.moveDown(0.8);

    // Patient + date row
    const dateStr = new Date(invoice.createdAt).toLocaleString('tr-TR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    doc.fontSize(10).font('Helvetica-Bold').text('Hasta:', { continued: true });
    doc
      .font('Helvetica')
      .text(` ${invoice.patient.firstName} ${invoice.patient.lastName} (${invoice.patient.mrn})`);
    if (invoice.patient.phone) {
      doc.fontSize(9).fillColor('#666').text(`Telefon: ${invoice.patient.phone}`);
      doc.fillColor('#000');
    }
    doc.fontSize(9).fillColor('#666').text(`Tarih: ${dateStr}`);
    doc.fillColor('#000');
    doc.moveDown(0.8);

    // Items table
    doc.fontSize(10).font('Helvetica-Bold');
    const yStart = doc.y;
    const colX = { desc: 30, qty: 230, price: 280, total: 340 };
    doc.text('Hizmet', colX.desc, yStart);
    doc.text('Adet', colX.qty, yStart, { width: 40, align: 'right' });
    doc.text('Birim', colX.price, yStart, { width: 55, align: 'right' });
    doc.text('Tutar', colX.total, yStart, { width: 60, align: 'right' });
    doc
      .moveTo(30, yStart + 15)
      .lineTo(400, yStart + 15)
      .strokeColor('#999')
      .stroke();
    doc.font('Helvetica');

    let y = yStart + 22;
    for (const item of invoice.items) {
      doc.fontSize(9).text(item.description, colX.desc, y, { width: 195 });
      doc.text(item.quantity.toString(), colX.qty, y, { width: 40, align: 'right' });
      doc.text(formatCurrency(item.unitPrice, invoice.currency), colX.price, y, {
        width: 55,
        align: 'right',
      });
      doc.text(formatCurrency(item.lineTotal, invoice.currency), colX.total, y, {
        width: 60,
        align: 'right',
      });
      y = Math.max(y + 14, doc.y);
    }

    doc.y = y;
    doc.moveDown(0.5);
    doc.moveTo(200, doc.y).lineTo(400, doc.y).strokeColor('#999').stroke();
    doc.moveDown(0.3);

    // Totals
    doc.fontSize(9);
    if (parseFloat(invoice.discount.toString()) > 0) {
      doc.text(`Ara toplam: ${formatCurrency(invoice.subtotal, invoice.currency)}`, 30, doc.y, {
        align: 'right',
      });
      doc.text(`İndirim: -${formatCurrency(invoice.discount, invoice.currency)}`, 30, doc.y, {
        align: 'right',
      });
    }
    doc
      .fontSize(11)
      .font('Helvetica-Bold')
      .text(`TOPLAM: ${formatCurrency(invoice.total, invoice.currency)}`, 30, doc.y, {
        align: 'right',
      });
    doc.font('Helvetica').fontSize(9);
    doc.moveDown(0.8);

    // Payments
    if (invoice.payments.length > 0) {
      doc.fontSize(10).font('Helvetica-Bold').text('Tahsilat:');
      doc.font('Helvetica').fontSize(9);
      for (const p of invoice.payments) {
        const methodLabel = METHOD_LABELS[p.method as keyof typeof METHOD_LABELS] ?? p.method;
        const pDate = new Date(p.takenAt).toLocaleString('tr-TR', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
        let line = `${pDate} · ${formatCurrency(p.amount, p.currency)} · ${methodLabel} · ${p.takenBy.name}`;
        if (p.currency !== invoice.currency) {
          line += ` (kur ${p.exchangeRate} → ${formatCurrency(p.tjsEquivalent, 'TJS')} karşılığı)`;
        }
        if (p.refundedAt) line += ' [İADE EDİLDİ]';
        doc.text(line);
        for (const r of p.refunds) {
          doc
            .fillColor('#b91c1c')
            .text(
              `  ↩ İade: ${formatCurrency(r.amount, r.currency)} — ${r.reason} (onay: ${r.approvedBy?.name ?? '—'})`,
            );
          doc.fillColor('#000');
        }
      }
      doc.moveDown(0.8);
    }

    // Footer
    doc
      .fontSize(8)
      .fillColor('#999')
      .text('Bu makbuz vergisiz/bilgilendirme amaçlıdır.', { align: 'center' });
    doc.fillColor('#000');
    doc.moveDown(0.5);
    doc.fontSize(8).text('İmza / Mühür: __________________', { align: 'right' });

    doc.end();
    const buffer = await done;
    return {
      buffer,
      filename: `makbuz-${invoice.invoiceNumber}.pdf`,
    };
  }
}

const METHOD_LABELS: Record<string, string> = {
  cash: 'Nakit',
  card: 'Kart (POS)',
  transfer: 'Havale',
  insurance: 'Sigorta',
};

function formatCurrency(value: Prisma.Decimal | string, currency: 'TJS' | 'USD'): string {
  const n = typeof value === 'string' ? parseFloat(value) : parseFloat(value.toString());
  if (currency === 'USD') return `$${n.toFixed(2)}`;
  return `${n.toFixed(2)} TJS`;
}
