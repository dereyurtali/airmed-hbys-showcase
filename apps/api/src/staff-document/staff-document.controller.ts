import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
  Body,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import type { JwtPayload } from '../auth/auth.types';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { StaffDocumentService } from './staff-document.service';

interface UploadBody {
  userId?: string;
  doctorId?: string;
  docType: string;
  note?: string;
}

// #1049 — Personel dökümanı REST yüzeyi. Mutasyonlar AuditInterceptor ile
// otomatik audit'lenir (POST/DELETE + auth'lu). Serve auth'lu StreamableFile —
// static serve YOK (İK verisi, KVKK).
@Controller('staff-documents')
export class StaffDocumentController {
  constructor(private readonly documents: StaffDocumentService) {}

  @Post()
  @RequirePermission('action:staffDocument.manage')
  // #927 multer limitleri: tek dosya + birkaç alan (DoS mitigasyonu).
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024, fields: 8, parts: 10 } }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: UploadBody,
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException('Missing file field');
    if (!body.docType) throw new BadRequestException('docType required');
    const user = req.user as JwtPayload | undefined;
    if (!user) throw new BadRequestException('Not authenticated');

    return this.documents.upload(
      {
        buffer: file.buffer,
        fileName: file.originalname,
        mimeType: file.mimetype,
        docType: body.docType,
        userId: body.userId ?? null,
        doctorId: body.doctorId ?? null,
        note: body.note ?? null,
      },
      { id: user.sub, roles: user.roles, effectivePerms: user.effectivePerms },
    );
  }

  // Görüntüleme: view:staffDocument YA DA kendi dökümanı — kural service
  // katmanında (accessScope). Bu yüzden decorator'suz (yalnız JWT).
  @Get(':id/file')
  serve(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ): Promise<StreamableFile> {
    const user = req.user as JwtPayload | undefined;
    if (!user) throw new BadRequestException('Not authenticated');
    return this.documents.serve(id, {
      id: user.sub,
      roles: user.roles,
      effectivePerms: user.effectivePerms,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('action:staffDocument.manage')
  async remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    await this.documents.softDelete(id);
  }
}
