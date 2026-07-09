import { Controller, Get, Param, ParseUUIDPipe, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ReceiptPdfService } from './receipt-pdf.service';

// S11e — Billing REST controller (yalnız PDF makbuz; CRUD tRPC tarafında).
// page:billing roles (front desk + admin) makbuz indirebilir.

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('yonetici', 'yonetici_asistani', 'resepsiyon')
@Controller('billing')
export class BillingController {
  constructor(private readonly receiptPdf: ReceiptPdfService) {}

  /**
   * GET /api/billing/invoices/:id/receipt.pdf
   * Klinik makbuzu PDF olarak indirir (A5, vergisiz, klinik logosu placeholder).
   */
  @Get('invoices/:id/receipt.pdf')
  async receipt(@Param('id', new ParseUUIDPipe()) id: string, @Res() res: Response): Promise<void> {
    const { buffer, filename } = await this.receiptPdf.generate(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length.toString());
    res.end(buffer);
  }
}
