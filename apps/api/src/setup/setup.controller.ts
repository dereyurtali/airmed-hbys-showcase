import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator';
import { BootstrapSetupDto } from './dto/bootstrap.dto';
import { SetupService } from './setup.service';

const TEST_BYPASS = process.env.NODE_ENV === 'test';
const tightLimit = (limit: number) => (TEST_BYPASS ? 10_000 : limit);

@Controller('setup')
export class SetupController {
  constructor(private readonly setup: SetupService) {}

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: tightLimit(20) } })
  @Get('status')
  status() {
    return this.setup.getStatus();
  }

  // 3 deneme/saat — yeterli, brute-force yok (setup endpoint'i tek user yokken
  // anlamlı; ilk başarılı çağrı sonrası hep 409 dönecek).
  //
  // FileInterceptor multipart/form-data parser: logo alanı opsiyonel. Browser
  // multipart gönderirse alan dolu olur, application/json gönderirse parser
  // sessizce geçer ve body class-validator ile parse edilir.
  @Public()
  @Throttle({ default: { ttl: 3_600_000, limit: tightLimit(3) } })
  @Post('bootstrap')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('logo', { limits: { fileSize: 2 * 1024 * 1024 } }))
  bootstrap(@Body() dto: BootstrapSetupDto, @UploadedFile() logo: Express.Multer.File | undefined) {
    const logoFile = logo ? { buffer: logo.buffer, mimeType: logo.mimetype } : undefined;
    return this.setup.bootstrap(dto, logoFile);
  }
}
