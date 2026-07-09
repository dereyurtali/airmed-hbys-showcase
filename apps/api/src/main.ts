import { Logger, RequestMethod, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { initSentry } from './observability/sentry';

async function bootstrap() {
  // SENTRY_DSN set ise hata izlemeyi başlat (yoksa dormant no-op). App
  // oluşmadan önce çağrılır ki erken bootstrap hataları da yakalanabilsin.
  initSentry();

  // rawBody: true — A12 sync /internal/sync endpoint HMAC imzasını parsed body'yi
  // yeniden serialize ederek hesaplıyordu (re-serialize farklı whitespace/key
  // ordering yaratabilir → saldırgan farklı payload ile aynı imzayı tetikleyebilir).
  // Express raw buffer'ını her request'te NestJS'in req.rawBody'ye expose et;
  // SyncReceiveController doğrudan bunu üzerine HMAC doğrular (denetim P0 2.10).
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });

  // Production'da nginx tek-hop reverse proxy arkasında çalışıyoruz (TLS nginx'te
  // terminate ediliyor — bkz. docs/deployment/production-runbook.md). `trust proxy`
  // olmadan Express her isteğin `req.ip`'sini nginx'in IP'si (127.0.0.1) olarak
  // görür; bu üç güvenlik katmanını sessizce çökertir:
  //   1. IP-bazlı throttle (login 5/dk, global 100/dk) tek kovaya düşer → tek
  //      başarısız seri tüm kliniğin login'ini kilitler, gerçek saldırgan gizlenir.
  //   2. audit_logs.ip + users.last_login_ip nginx IP'sini yazar (KVKK izlenebilirlik).
  //   3. fraud `multi_ip_login` kuralı herkesi tek IP gördüğü için hiç tetiklenmez.
  // `1` = yalnız tek bilinen proxy hop'una güven; X-Forwarded-For spoofing'e kapalı
  // (saldırganın eklediği soldaki değerlere güvenilmez, en sağdaki proxy değeri alınır).
  // Dev/test'te (proxy yok) zararsız — soket IP'si zaten gerçek istemci.
  app.set('trust proxy', 1);

  // #935 — JSON/urlencoded body-size limitini explicit belirle. Varsayılan ~100KB
  // bazı yolları (sync batch, feedback ekran görüntüsü base64) keser; 10MB legit
  // payload'lara yer bırakır ama unbounded body DoS'unu önler. rawBody: true ile
  // oluşturulan app'te useBodyParser rawBody yakalamayı KORUR → sync /internal/sync
  // HMAC hâlâ req.rawBody'den doğrulanır. BODY_LIMIT env ile ayarlanabilir.
  const bodyLimit = process.env.BODY_LIMIT ?? '10mb';
  app.useBodyParser('json', { limit: bodyLimit });
  app.useBodyParser('urlencoded', { limit: bodyLimit, extended: true });

  // A13 — Helmet sıkılaştırılmış config.
  // - frameguard DENY: hiç iframe içine girmesin (clickjacking)
  // - referrer 'no-referrer': cross-site referrer leak yok
  // - HSTS yalnızca HTTPS arkasında anlamlı; nginx TLS terminate ettikten sonra
  //   prod env'de etkin. Dev'de off bırak (mixed-content uyarıları olmasın).
  // - CSP: API yalnızca JSON dönüyor; SPA'lar kendi origin'lerinden inline
  //   eval/script çalıştırmıyor — default-src 'self' minimum.
  const isProd = process.env.NODE_ENV === 'production';
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"], // shadcn/Tailwind runtime inline gerekli
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false, // foto galeri + QR data: URL'leri için
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      referrerPolicy: { policy: 'no-referrer' },
      hsts: isProd ? { maxAge: 31536000, includeSubDomains: true, preload: false } : false,
      frameguard: { action: 'deny' },
      hidePoweredBy: true,
      noSniff: true,
    }),
  );
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      // Reject payloads that carry extra fields instead of silently
      // dropping them — surfaces typos and prevents passthrough drift.
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // A13 — CORS whitelist.
  // WEB_ORIGIN / ADMIN_ORIGIN virgülle ayrılmış liste destekler (CDN /
  // farklı klinik subdomain'leri için). Origin gelmeyen istek (server-to-server,
  // curl) credentials'lı olamayacağı için zaten geçer.
  const splitOrigins = (raw: string | undefined, fallback: string) =>
    (raw ?? fallback)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  const allowedOrigins = [
    ...splitOrigins(process.env.WEB_ORIGIN, 'http://localhost:5173'),
    ...splitOrigins(process.env.ADMIN_ORIGIN, 'http://localhost:5174'),
  ];
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: 86400,
  });

  // /platform/* routes opt out of the global /api prefix because they are
  // a separate authentication boundary (PLATFORM_JWT_*, no tenant context).
  app.setGlobalPrefix('api', {
    exclude: [{ path: 'platform/(.*)', method: RequestMethod.ALL }],
  });

  // #935 — SIGTERM/SIGINT'te OnModuleDestroy hook'ları (PrismaService + #916/#958
  // admin client'ları) tetiklensin → redeploy'da DB bağlantıları temiz kapanır.
  app.enableShutdownHooks();

  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port);
  new Logger('Bootstrap').log(
    `API listening on http://localhost:${port} (tenant: /api, platform: /platform)`,
  );
}

void bootstrap();
