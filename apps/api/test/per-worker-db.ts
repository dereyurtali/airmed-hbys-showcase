/**
 * Jest `setupFiles` — HER worker process'inde, test framework + test dosyası
 * yüklenmeden ÖNCE koşar. DATABASE_URL + DATABASE_URL_APP'i bu worker'ın
 * globalSetup'ta hazırlanmış izole DB'sine (`<base>_w{JEST_WORKER_ID}`)
 * yönlendirir. Senkron — DB'ler zaten var, sadece env yeniden yazılır.
 *
 * Sentinel guard: setupFiles dosya başına bir kez koşar; aynı worker'da ikinci
 * dosyada DATABASE_URL zaten `_w{id}` olduğundan tekrar yazmamak için __E2E_WORKER_DB
 * işaretine bakar (env worker process boyunca kalıcı).
 *
 * Worker DB ad formülü setup.ts `workerDbName` ile AYNI tutulmalı.
 */
if (process.env.DATABASE_URL && !process.env.__E2E_WORKER_DB) {
  const workerId = process.env.JEST_WORKER_ID ?? '1';
  const url = new URL(process.env.DATABASE_URL);
  const baseDb = url.pathname.replace(/^\//, '').split('?')[0];
  const workerDb = `${baseDb}_w${workerId}`;

  url.pathname = `/${workerDb}`;
  // Havuz boyutunu çekirdek sayısından bağımsız sabitle: Prisma default'u
  // num_cpus*2+1 → çok çekirdekli runner'da N worker × büyük havuz postgres
  // max_connections'ını (100) aşabilir. Worker başına sınırla.
  url.searchParams.set('connection_limit', '5');
  process.env.DATABASE_URL = url.toString();

  const appUrl = new URL(process.env.DATABASE_URL);
  appUrl.username = 'airmed_app';
  appUrl.password = 'airmed_app_dev';
  process.env.DATABASE_URL_APP = appUrl.toString();

  process.env.__E2E_WORKER_DB = workerDb;
}
