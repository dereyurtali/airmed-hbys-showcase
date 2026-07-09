/**
 * admin-bootstrap.ts — klinik lokal sunucusunda ilk yönetici hesabı kurulumu.
 *
 * Akış:
 *  1. Klinik slug + ad + MRN prefix sorulur (veya env var ile non-interactive)
 *  2. Tenant upsert (mevcutsa onay alınır, label güncellenir)
 *  3. 10 default rol seedlenir (DEFAULT_CLINIC_ROLES — seed.ts ile aynı kaynak)
 *  4. Yönetici e-posta + adı sorulur; şifre opsiyonel (boşsa 12-char üretilir)
 *  5. bcrypt(12) hash + mustChangePassword=true ile User + UserRole upsert
 *  6. Son ekrana giriş bilgileri basılır (şifre bir kere — kopyalanmalı)
 *
 * Kullanım:
 *   npm run admin:bootstrap                            # interaktif
 *   npm run admin:bootstrap -- --non-interactive       # env var'lardan oku
 *
 * Non-interactive env var'ları (eksik olanlar zorunlu):
 *   ADMIN_BOOTSTRAP_SLUG           ör: demoeye-dushanbe
 *   ADMIN_BOOTSTRAP_NAME           ör: "DemoEye Clinic"
 *   ADMIN_BOOTSTRAP_MRN_PREFIX     ör: TD (2-3 büyük harf)
 *   ADMIN_BOOTSTRAP_EMAIL          ör: yonetici@demoeye.tj
 *   ADMIN_BOOTSTRAP_ADMIN_NAME     ör: "Klinik Yöneticisi"
 *   ADMIN_BOOTSTRAP_PASSWORD       opsiyonel — boşsa üretilir
 *   ADMIN_BOOTSTRAP_FORCE_UPDATE   "true" → mevcut tenant onay sormaz, sıfırlar
 */
import { PrismaClient, ensureClinicRoles } from '@airmed/db';
import * as bcrypt from 'bcrypt';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output, env, exit, argv } from 'node:process';
import { generateStrongPassword } from '../src/auth/password.util';

const BCRYPT_COST = 12;
const SLUG_RE = /^[a-z0-9-]{3,40}$/;
const MRN_PREFIX_RE = /^[A-Z]{2,3}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const NON_INTERACTIVE = argv.includes('--non-interactive');

interface BootstrapInput {
  slug: string;
  clinicName: string;
  mrnPrefix: string;
  adminEmail: string;
  adminName: string;
  adminPassword?: string;
  forceUpdate: boolean;
}

async function collectInput(): Promise<BootstrapInput> {
  if (NON_INTERACTIVE) {
    return collectFromEnv();
  }
  return collectFromPrompt();
}

function collectFromEnv(): BootstrapInput {
  const required = {
    slug: env.ADMIN_BOOTSTRAP_SLUG,
    clinicName: env.ADMIN_BOOTSTRAP_NAME,
    mrnPrefix: env.ADMIN_BOOTSTRAP_MRN_PREFIX,
    adminEmail: env.ADMIN_BOOTSTRAP_EMAIL,
    adminName: env.ADMIN_BOOTSTRAP_ADMIN_NAME,
  };
  const missing = Object.entries(required)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length > 0) {
    throw new Error(
      `non-interactive modu eksik env var(lar): ${missing.join(', ')} (bkz. script başlığı)`,
    );
  }
  validateSlug(required.slug!);
  validateMrnPrefix(required.mrnPrefix!);
  validateEmail(required.adminEmail!);
  return {
    slug: required.slug!,
    clinicName: required.clinicName!,
    mrnPrefix: required.mrnPrefix!,
    adminEmail: required.adminEmail!,
    adminName: required.adminName!,
    adminPassword: env.ADMIN_BOOTSTRAP_PASSWORD || undefined,
    forceUpdate: env.ADMIN_BOOTSTRAP_FORCE_UPDATE === 'true',
  };
}

async function collectFromPrompt(): Promise<BootstrapInput> {
  const rl = createInterface({ input, output });
  try {
    const slug = await ask(rl, "Klinik slug (subdomain, örn 'demoeye-dushanbe'): ", validateSlug);
    const clinicName = await ask(rl, 'Klinik adı: ', (v) => {
      if (v.trim().length < 2) throw new Error('en az 2 karakter');
    });
    const mrnPrefix = await ask(rl, "MRN prefix (2-3 büyük harf, örn 'TD'): ", validateMrnPrefix);
    const adminEmail = await ask(rl, 'Yönetici e-posta: ', validateEmail);
    const adminName = await ask(rl, 'Yönetici adı: ', (v) => {
      if (v.trim().length < 2) throw new Error('en az 2 karakter');
    });
    const rawPwd = await ask(rl, 'Şifre (boş bırakırsanız 12 karakter üretilir): ', () => {});
    const adminPassword = rawPwd.trim() || undefined;
    return {
      slug: slug.trim(),
      clinicName: clinicName.trim(),
      mrnPrefix: mrnPrefix.trim(),
      adminEmail: adminEmail.trim().toLowerCase(),
      adminName: adminName.trim(),
      adminPassword,
      forceUpdate: false,
    };
  } finally {
    rl.close();
  }
}

async function ask(
  rl: ReturnType<typeof createInterface>,
  q: string,
  validate: (v: string) => void,
): Promise<string> {
  for (;;) {
    const raw = (await rl.question(q)).trim();
    try {
      validate(raw);
      return raw;
    } catch (err) {
      console.error(`  ✗ ${(err as Error).message}`);
    }
  }
}

function validateSlug(v: string): void {
  if (!SLUG_RE.test(v)) {
    throw new Error("slug 3-40 karakter, küçük harf/rakam/tire içermeli (örn 'demoeye-dushanbe')");
  }
}

function validateMrnPrefix(v: string): void {
  if (!MRN_PREFIX_RE.test(v)) {
    throw new Error("MRN prefix 2-3 BÜYÜK harf olmalı (örn 'TD')");
  }
}

function validateEmail(v: string): void {
  if (!EMAIL_RE.test(v)) {
    throw new Error('geçerli bir e-posta adresi girin');
  }
}

async function confirmExistingTenant(
  rl: ReturnType<typeof createInterface>,
  existingName: string,
): Promise<boolean> {
  const answer = (
    await rl.question(
      `\nBu slug için tenant zaten var: "${existingName}". ` +
        'Yönetici şifresi sıfırlanacak ve klinik adı/MRN prefix güncellenecek.\n' +
        'Devam edilsin mi? (y/N): ',
    )
  )
    .trim()
    .toLowerCase();
  return answer === 'y' || answer === 'yes' || answer === 'evet';
}

async function bootstrap(input: BootstrapInput): Promise<{ password: string }> {
  const prisma = new PrismaClient();
  try {
    const existing = await prisma.tenant.findUnique({ where: { slug: input.slug } });

    if (existing && !input.forceUpdate && !NON_INTERACTIVE) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        const ok = await confirmExistingTenant(rl, existing.name);
        if (!ok) {
          console.warn('İptal edildi.');
          exit(0);
        }
      } finally {
        rl.close();
      }
    }

    const tenant = await prisma.tenant.upsert({
      where: { slug: input.slug },
      update: { name: input.clinicName, mrnPrefix: input.mrnPrefix },
      create: {
        slug: input.slug,
        name: input.clinicName,
        status: 'active',
        plan: 'pilot',
        locale: 'tr',
        timezone: 'Asia/Dushanbe',
        mrnPrefix: input.mrnPrefix,
      },
    });
    console.warn(`✓ Tenant: ${tenant.slug} (${tenant.id})`);

    // RLS context — yeni eklenecek user/role insert'leri için tenant scope set
    await prisma.$executeRawUnsafe(`SET app.current_tenant_id = '${tenant.id}'`);

    await ensureClinicRoles(prisma, tenant.id);
    console.warn('✓ Roller seedlendi: 7 klinik rol (hepsi default aktif)');

    const yoneticiRole = await prisma.role.findUniqueOrThrow({
      where: { tenantId_key: { tenantId: tenant.id, key: 'yonetici' } },
    });

    const password = input.adminPassword || generateStrongPassword();
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

    const adminUser = await prisma.user.upsert({
      where: { tenantId_email: { tenantId: tenant.id, email: input.adminEmail } },
      update: {
        passwordHash,
        name: input.adminName,
        status: 'active',
        mustChangePassword: true,
        failedLoginCount: 0,
        lockedUntil: null,
      },
      create: {
        tenantId: tenant.id,
        email: input.adminEmail,
        passwordHash,
        name: input.adminName,
        locale: 'tr',
        status: 'active',
        mustChangePassword: true,
      },
    });
    console.warn(`✓ Yönetici hesabı: ${adminUser.email}`);

    await prisma.userRole.upsert({
      where: {
        tenantId_userId_roleId: {
          tenantId: tenant.id,
          userId: adminUser.id,
          roleId: yoneticiRole.id,
        },
      },
      update: {},
      create: {
        tenantId: tenant.id,
        userId: adminUser.id,
        roleId: yoneticiRole.id,
      },
    });
    console.warn('✓ Yönetici rolü atandı');

    return { password };
  } finally {
    await prisma.$disconnect();
  }
}

function printSummary(input: BootstrapInput, password: string): void {
  const divider = '─'.repeat(60);
  const url = `https://${input.slug}.hbys.dnasoft.co`;
  console.warn(`\n${divider}`);
  console.warn('🔐  Yönetici giriş bilgileri');
  console.warn(divider);
  console.warn(`   E-posta : ${input.adminEmail}`);
  console.warn(`   Şifre   : ${password}`);
  console.warn(`   URL     : ${url}`);
  console.warn(divider);
  console.warn('Bu şifre TEKRAR GÖSTERİLMEZ. Şimdi kopyalayın ve güvenli kanaldan iletin.');
  console.warn('İlk girişte yönetici kendi şifresini değiştirmek zorundadır.\n');
}

async function main(): Promise<void> {
  console.warn('AirMed-HBYS — Klinik Yönetici Bootstrap\n');
  const bootstrapInput = await collectInput();
  const { password } = await bootstrap(bootstrapInput);
  printSummary(bootstrapInput, password);
}

main().catch((err: unknown) => {
  console.error('\n✗ Bootstrap başarısız:', err instanceof Error ? err.message : String(err));
  exit(1);
});
