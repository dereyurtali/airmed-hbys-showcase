import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import type { JwtPayload } from '../auth/auth.types';
import { Public } from '../auth/decorators/public.decorator';
import { ClinicLogoService } from './clinic-logo.service';

@Controller('clinic-settings/logo')
export class ClinicLogoController {
  constructor(private readonly logos: ClinicLogoService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }))
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request,
  ): Promise<{ logoUrl: string }> {
    if (!file) throw new BadRequestException('file alanı eksik');
    const user = req.user as JwtPayload | undefined;
    if (!user) throw new BadRequestException('Oturum bilgisi yok');
    return this.logos.upload(
      { buffer: file.buffer, mimeType: file.mimetype },
      { roles: user.roles, effectivePerms: user.effectivePerms },
    );
  }

  // Logo `<img src="...">` ile çekiliyor; browser auth header geçemez.
  // Logo non-sensitive marka assets'i — public + tenant query param zorunlu
  // (tenant adı zaten subdomain'de açıkta). Public-monitor / login öncesi gibi
  // pre-auth bağlamlarda da tek noktadan servis edilir.
  @Public()
  @Get('file')
  serve(@Query('tenantId') tenantId: string | undefined): Promise<StreamableFile> {
    return this.logos.getStreamPublic(tenantId);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Req() req: Request): Promise<void> {
    const user = req.user as JwtPayload | undefined;
    if (!user) throw new BadRequestException('Oturum bilgisi yok');
    await this.logos.remove({ roles: user.roles, effectivePerms: user.effectivePerms });
  }
}
