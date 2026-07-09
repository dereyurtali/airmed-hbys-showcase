import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { BlockImpersonation } from '../auth/decorators/block-impersonation.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  DoctorCreateInput,
  DoctorListQuery,
  DoctorUpdateInput,
  SetAvailabilityInput,
  doctorCreateSchema,
  doctorListQuerySchema,
  doctorUpdateSchema,
  setAvailabilitySchema,
} from './doctor.schemas';
import { DoctorService } from './doctor.service';

// Read access for any clinic role; write/delete restricted to managers.
const READ_ROLES = ['yonetici', 'yonetici_asistani', 'doktor', 'resepsiyon'] as const;
const WRITE_ROLES = ['yonetici', 'yonetici_asistani'] as const;

@UseGuards(RolesGuard)
@Controller('doctors')
export class DoctorController {
  constructor(private readonly doctors: DoctorService) {}

  @Get()
  @Roles(...READ_ROLES)
  list(@Query(new ZodValidationPipe(doctorListQuerySchema)) query: DoctorListQuery) {
    return this.doctors.list(query);
  }

  @Get(':id')
  @Roles(...READ_ROLES)
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.doctors.findById(id);
  }

  @Post()
  @Roles(...WRITE_ROLES)
  @HttpCode(HttpStatus.CREATED)
  create(@Body(new ZodValidationPipe(doctorCreateSchema)) dto: DoctorCreateInput) {
    return this.doctors.create(dto);
  }

  @Patch(':id')
  @Roles(...WRITE_ROLES)
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(doctorUpdateSchema)) dto: DoctorUpdateInput,
  ) {
    return this.doctors.update(id, dto);
  }

  // P0 2.4 — Doktor pasifleştirme platform admin impersonation oturumunda
  // yapılamaz; klinik adına personel kaydı silmek platform support kapsamı dışında.
  @Delete(':id')
  @Roles(...WRITE_ROLES)
  @BlockImpersonation()
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', new ParseUUIDPipe()) id: string) {
    await this.doctors.softDelete(id);
  }

  @Get(':id/availability')
  @Roles(...READ_ROLES)
  listAvailability(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.doctors.listAvailability(id);
  }

  @Put(':id/availability')
  @Roles(...WRITE_ROLES)
  setAvailability(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(setAvailabilitySchema)) dto: SetAvailabilityInput,
  ) {
    return this.doctors.setAvailability(id, dto);
  }

  // #1049 — Doktor profil fotoğrafı (clinic-logo deseni: 2MB, png/jpeg/webp).
  // Magic-byte doğrulama service katmanında.
  @Post(':id/photo')
  @Roles(...WRITE_ROLES)
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024, fields: 4, parts: 6 } }),
  )
  uploadPhoto(
    @Param('id', new ParseUUIDPipe()) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) throw new BadRequestException('file alanı eksik');
    return this.doctors.uploadPhoto(id, { buffer: file.buffer, mimeType: file.mimetype });
  }

  // Foto düşük hassasiyetli personel görselidir; auth'lu her klinik kullanıcısı
  // görebilir (READ_ROLES kısıtı yok — hemşire/ölçüm ekranları da gösterir).
  @Get(':id/photo/file')
  servePhoto(@Param('id', new ParseUUIDPipe()) id: string): Promise<StreamableFile> {
    return this.doctors.servePhoto(id);
  }
}
