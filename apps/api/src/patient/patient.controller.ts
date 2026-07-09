import {
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
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type { JwtPayload } from '../auth/auth.types';
import { BlockImpersonation } from '../auth/decorators/block-impersonation.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  PatientCreateInput,
  PatientDuplicatesInput,
  PatientListQuery,
  PatientUpdateInput,
  patientCreateSchema,
  patientDuplicatesSchema,
  patientListQuerySchema,
  patientUpdateSchema,
} from './patient.schemas';
import { PatientService } from './patient.service';

@UseGuards(RolesGuard)
// READ_ROLES — class-level "hasta endpoint'ine erişim" sınırı (hemşire dışı 4 rol).
// S10c sonrası WRITE perm'ları method-level @RequirePermission ile daha sıkı:
// - create: yonetici + asistan + resepsiyon (doktor ÇIKARILDI, S10c)
// - update: yonetici + asistan + doktor + resepsiyon (mevcut)
// - softDelete: yonetici (en sıkı)
// Class decorator "kim sayfayı görür"; method decorator "kim aksiyon yapar".
@Roles('yonetici', 'yonetici_asistani', 'doktor', 'resepsiyon')
@Controller('patients')
export class PatientController {
  constructor(private readonly patients: PatientService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(patientListQuerySchema)) query: PatientListQuery,
    @Req() req: Request & { user?: JwtPayload },
  ) {
    // S4+S5 — Doktor sıkı izolasyon: actor (roles + flags) service'e geçer.
    // flags JWT'den (can_see_all_patients override, is_visiting_doctor kısıtla).
    const actor = req.user
      ? { userId: req.user.sub, roles: req.user.roles, flags: req.user.flags }
      : null;
    return this.patients.list(query, actor);
  }

  @Get(':id')
  findOne(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request & { user?: JwtPayload },
  ) {
    // #665 — REST findById de actor geçirmeli: aksi halde misafir doktor (sıkı
    // izolasyon) bu uçtan tenant'taki HER hastayı okuyabiliyordu (tRPC byId
    // actor'lı, REST değildi). list ile aynı actor bağlamı.
    const actor = req.user
      ? { userId: req.user.sub, roles: req.user.roles, flags: req.user.flags }
      : null;
    return this.patients.findById(id, actor);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('action:patient.create')
  create(
    @Body(new ZodValidationPipe(patientCreateSchema)) dto: PatientCreateInput,
    @Req() req: Request & { user?: JwtPayload },
    @Query('force') force?: string,
  ) {
    // S4 — primaryDoctorId opsiyonel (schema'da). assignedBy actor.userId.
    // S10c — Doktor patient.create yetkisinden çıkartıldı; front desk işi.
    const actor = req.user ? { userId: req.user.sub } : null;
    return this.patients.create(dto, force === 'true', actor);
  }

  @Patch(':id')
  @RequirePermission('action:patient.update')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(patientUpdateSchema)) dto: PatientUpdateInput,
  ) {
    return this.patients.update(id, dto);
  }

  // S3 — Karar 5: hasta silme sadece yönetici. @RequirePermission permissions.ts
  // registry'sinden 'action:patient.softDelete' kontrol eder (yonetici only).
  // @BlockImpersonation impersonation oturumunda silme engelliyor (P0 2.4).
  // Class-level @Roles(...) decorator hasta endpoint'lerine erişimi 4 role
  // veriyor; daha sıkı kontrol bu method-level @RequirePermission'dan gelir.
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @BlockImpersonation()
  @RequirePermission('action:patient.softDelete')
  async remove(@Param('id', new ParseUUIDPipe()) id: string) {
    await this.patients.softDelete(id);
  }

  @Post('duplicates')
  @HttpCode(HttpStatus.OK)
  duplicates(@Body(new ZodValidationPipe(patientDuplicatesSchema)) dto: PatientDuplicatesInput) {
    return this.patients.findDuplicates(dto);
  }
}
