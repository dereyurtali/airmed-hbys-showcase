import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { LabService } from './lab.service';

interface JwtUser {
  sub: string;
  roles: readonly string[];
}

@Controller('lab-tests')
export class LabController {
  constructor(private readonly lab: LabService) {}

  @Post(':id/file')
  // #927 — multer field/part limitleri (nested-field DoS mitigasyonu; auth-gated).
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024, fields: 12, parts: 15 } }),
  )
  async uploadFile(
    @Param('id', new ParseUUIDPipe()) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException('Missing file field');
    const user = req.user as JwtUser | undefined;
    if (!user) throw new BadRequestException('Not authenticated');

    return this.lab.attachFile(
      {
        id,
        buffer: file.buffer,
        fileName: file.originalname,
        mimeType: file.mimetype,
      },
      { id: user.sub, roles: user.roles },
    );
  }

  // #922 — lab dosyasını streamleyen endpoint lab geçmişini görme yetkisi ister.
  // Önceden yalnız JwtAuthGuard vardı → UUID bilen within-tenant her kullanıcı
  // hasta lab dosyasını (PII) indirebiliyordu. serveFile(id) servise rol
  // taşımadığı için controller guard'ı tek koruma.
  @Get(':id/file')
  @RequirePermission('view:patient.lab_history')
  async serveFile(@Param('id', new ParseUUIDPipe()) id: string): Promise<StreamableFile> {
    return this.lab.serveFile(id);
  }
}
