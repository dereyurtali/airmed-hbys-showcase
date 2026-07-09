import {
  BadRequestException,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { FeedbackService } from './feedback.service';

// I2.3 (#821) — Ek dosya yükleme (screenshot/video/anotasyon). tRPC JSON taşımaz
// → REST multipart (PhotoController deseni). storage_data volume'una yazılır.
@Controller('feedback')
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Post(':id/attachments')
  @RequirePermission('action:feedback.create')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024 } }))
  async addAttachment(
    @Param('id', new ParseUUIDPipe()) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException('Dosya alanı eksik');
    const kind = ((req.body as { kind?: string } | undefined)?.kind ?? 'screenshot').toString();
    return this.feedback.addAttachment(id, {
      buffer: file.buffer,
      mimeType: file.mimetype,
      kind,
    });
  }
}
