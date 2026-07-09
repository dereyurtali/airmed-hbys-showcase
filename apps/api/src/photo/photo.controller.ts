import {
  BadRequestException,
  Body,
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
import { PhotoService } from './photo.service';

interface JwtUser {
  sub: string;
  roles: readonly string[];
}

interface UploadBody {
  patientId: string;
  tag?: string;
  description?: string;
  takenAt?: string;
}

const VALID_TAGS = new Set([
  'preop',
  'postop',
  'intraop',
  'oct',
  'fundus',
  'topography',
  'general',
]);

@Controller('photos')
export class PhotoController {
  constructor(private readonly photos: PhotoService) {}

  // #663 güvenlik — klinik foto galerisi yüklemesi yalnız klinik personeli
  // (action:photo.upload = [doktor, hemsire]). Önceden guard yoktu → her
  // authenticated kullanıcı (kilitli-mod kiosk dahil) hasta fotosu yükleyebiliyordu.
  // Hasta PROFIL fotosu ayrı endpoint (action:patient.uploadPhoto, ön büro).
  @Post('upload')
  @RequirePermission('action:photo.upload')
  // #927 — multer field/part limitleri: 'deeply nested field names DoS' (fixAvail
  // yok) mitigasyonu; endpoint auth-gated (#922) + tek dosya + birkaç alan.
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, fields: 12, parts: 15 } }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: UploadBody,
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException('Missing file field');
    if (!body.patientId) throw new BadRequestException('patientId required');

    const tag = body.tag ?? 'general';
    if (!VALID_TAGS.has(tag)) {
      throw new BadRequestException(`Invalid tag: ${tag}`);
    }

    const user = req.user as JwtUser | undefined;
    if (!user) throw new BadRequestException('Not authenticated');

    return this.photos.upload(
      {
        patientId: body.patientId,
        buffer: file.buffer,
        fileName: file.originalname,
        mimeType: file.mimetype,
        tag,
        description: body.description ?? null,
        takenAt: body.takenAt ?? null,
      },
      { id: user.sub, roles: user.roles },
    );
  }

  // #922 — foto dosyasını streamleyen endpoint galeriyi görme yetkisi ister.
  // Önceden yalnız JwtAuthGuard vardı → UUID bilen within-tenant her kullanıcı
  // (ör. resepsiyon) hasta PII fotosunu indirebiliyordu. serve(id) servise rol
  // taşımadığı için controller guard'ı tek koruma.
  @Get(':id/serve')
  @RequirePermission('view:patient.photo_gallery')
  async serve(@Param('id', new ParseUUIDPipe()) id: string): Promise<StreamableFile> {
    return this.photos.serve(id);
  }
}
