import { Controller, Get } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Public } from '../auth/decorators/public.decorator';

// Sürüm tek kaynaktan okunur: apps/api/package.json. Hardcoded string İKİ KEZ
// drift etti (#564 v0.4.0 bump → /api/health 0.3.0; #732 v0.4.2 bump → 0.4.1
// kaldı). Runtime'da okuyarak bir daha elle güncelleme gerekmesin. __dirname hem
// dev (src/health) hem prod (dist/health) için apps/api'nin 2 alt klasörü →
// '../../package.json' iki ortamda da apps/api/package.json'a çözülür (Docker bunu
// /repo/apps/api/package.json'a kopyalar). rootDir './src' olduğundan derleme-zamanı
// import edemeyiz; runtime readFileSync rootDir kontrolünü tetiklemez.
function resolveApiVersion(): string {
  try {
    const raw = readFileSync(join(__dirname, '../../package.json'), 'utf8');
    return (JSON.parse(raw).version as string | undefined) ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

const API_VERSION = resolveApiVersion();

@Controller('health')
export class HealthController {
  @Public()
  @Get()
  check() {
    return {
      status: 'ok',
      service: 'airmed-hbys-api',
      version: API_VERSION,
      timestamp: new Date().toISOString(),
    };
  }
}
