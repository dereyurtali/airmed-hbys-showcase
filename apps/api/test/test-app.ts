import type { INestApplication } from '@nestjs/common';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from '../src/app.module';

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  // rawBody: true — main.ts ile aynı; A12 sync receive HMAC raw buffer
  // gerektiriyor. e2e testleri prod davranışını yakalasın.
  const app = moduleRef.createNestApplication({ rawBody: true });
  // Mirror main.ts: Helmet + CORS + cookie + ValidationPipe. e2e suite'lar
  // güvenlik header'larını + CORS davranışını gerçek prod ile aynı şekilde
  // test edebilsin.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      referrerPolicy: { policy: 'no-referrer' },
      hsts: false,
      frameguard: { action: 'deny' },
      hidePoweredBy: true,
      noSniff: true,
    }),
  );
  app.use(cookieParser());
  app.enableCors({
    origin: ['http://localhost:5173', 'http://localhost:5174'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: 86400,
  });
  // Mirror main.ts exactly: forbidNonWhitelisted aktif değilse e2e testleri
  // prod davranışını yakalamıyor — payload'a sızan extra field testte sessizce
  // drop olurken prod'da 400'e döner (denetim P0 2.11).
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  // /platform/* opts out of the /api prefix so e2e tests can hit platform
  // endpoints at the real production paths.
  app.setGlobalPrefix('api', {
    exclude: [{ path: 'platform/(.*)', method: RequestMethod.ALL }],
  });
  await app.init();
  return app;
}
