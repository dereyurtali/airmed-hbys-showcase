/**
 * platform-admin-bootstrap.ts — ilk DNA Platform Admin hesabını kurar (#847).
 *
 * Klinik `admin-bootstrap.ts`'in platform muadili: `platform_admins` tablosuna
 * (tenant'sız, ayrı JWT secret + TOTP) bir hesap ekler/sıfırlar. Platform admin
 * normalde yalnız dev seed'inde üretilir; staging/prod seed'lenmediği için panel
 * login'i için bu CLI gerekir. TOTP burada KURULMAZ — ilk login'de panel
 * üzerinden kurulur (totpSecret null → totp_setup_required challenge).
 *
 * Akış:
 *  1. E-posta + ad + rol sorulur (veya env ile non-interactive); şifre opsiyonel.
 *  2. bcrypt(12) hash + isActive=true ile platform_admins upsert.
 *  3. Mevcut hesap varsa (forceUpdate/onay) şifre sıfırlanır + TOTP temizlenir
 *     (yeniden kurulum için) + kilit açılır.
 *  4. Giriş bilgileri bir kez basılır.
 *
 * Kullanım:
 *   npm run platform:admin:bootstrap                       # interaktif
 *   npm run platform:admin:bootstrap -- --non-interactive  # env var'lardan oku
 *
 * Non-interactive env var'ları (eksik olanlar zorunlu):
 *   PLATFORM_ADMIN_BOOTSTRAP_EMAIL          ör: ali@dnasoft.co
 *   PLATFORM_ADMIN_BOOTSTRAP_NAME           ör: "Ali Dereyurt"
 *   PLATFORM_ADMIN_BOOTSTRAP_ROLE           platform_owner | platform_engineer | platform_support (vars: platform_owner)
 *   PLATFORM_ADMIN_BOOTSTRAP_PASSWORD       opsiyonel — boşsa 16-char üretilir
 *   PLATFORM_ADMIN_BOOTSTRAP_FORCE_UPDATE   "true" → mevcut hesabı onay sormadan sıfırla
 */
import { PrismaClient } from '@airmed/db';
import * as bcrypt from 'bcrypt';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output, env, exit, argv } from 'node:process';
import { generateStrongPassword } from '../src/auth/password.util';

// PlatformRole enum'u Prisma string-literal union'ı; @airmed/db re-export etmediği
// için lokal tanım (schema.prisma PlatformRole ile birebir).
type PlatformRole = 'platform_owner' | 'platform_engineer' | 'platform_support';

const BCRYPT_COST = 12;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES: PlatformRole[] = ['platform_owner', 'platform_engineer', 'platform_support'];

const NON_INTERACTIVE = argv.includes('--non-interactive');

interface BootstrapInput {
  email: string;
  name: string;
  role: PlatformRole;
  password?: string;
  forceUpdate: boolean;
}

async function collectInput(): Promise<BootstrapInput> {
  return NON_INTERACTIVE ? collectFromEnv() : collectFromPrompt();
}

function collectFromEnv(): BootstrapInput {
  const required = {
    email: env.PLATFORM_ADMIN_BOOTSTRAP_EMAIL,
    name: env.PLATFORM_ADMIN_BOOTSTRAP_NAME,
  };
  const missing = Object.entries(required)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length > 0) {
    throw new Error(
      `non-interactive modu eksik env var(lar): ${missing.join(', ')} (bkz. script başlığı)`,
    );
  }
  validateEmail(required.email!);
  const role = parseRole(env.PLATFORM_ADMIN_BOOTSTRAP_ROLE);
  return {
    email: required.email!.toLowerCase(),
    name: required.name!,
    role,
    password: env.PLATFORM_ADMIN_BOOTSTRAP_PASSWORD || undefined,
    forceUpdate: env.PLATFORM_ADMIN_BOOTSTRAP_FORCE_UPDATE === 'true',
  };
}

async function collectFromPrompt(): Promise<BootstrapInput> {
  const rl = createInterface({ input, output });
  try {
    const email = await ask(rl, 'Platform admin e-posta: ', validateEmail);
    const name = await ask(rl, 'Ad: ', (v) => {
      if (v.trim().length < 2) throw new Error('en az 2 karakter');
    });
    const roleRaw = await ask(rl, `Rol (${ROLES.join(' / ')}) [platform_owner]: `, (v) => {
      if (v.trim()) parseRole(v.trim());
    });
    const rawPwd = await ask(rl, 'Şifre (boş bırakırsanız 16 karakter üretilir): ', () => {});
    return {
      email: email.trim().toLowerCase(),
      name: name.trim(),
      role: roleRaw.trim() ? parseRole(roleRaw.trim()) : 'platform_owner',
      password: rawPwd.trim() || undefined,
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

function validateEmail(v: string): void {
  if (!EMAIL_RE.test(v)) throw new Error('geçerli bir e-posta adresi girin');
}

function parseRole(v: string | undefined): PlatformRole {
  if (!v) return 'platform_owner';
  if (!ROLES.includes(v as PlatformRole)) {
    throw new Error(`rol şunlardan biri olmalı: ${ROLES.join(', ')}`);
  }
  return v as PlatformRole;
}

async function confirmExisting(
  rl: ReturnType<typeof createInterface>,
  email: string,
): Promise<boolean> {
  const answer = (
    await rl.question(
      `\nBu e-posta için platform admin zaten var: "${email}".\n` +
        'Şifre SIFIRLANACAK, TOTP temizlenecek (yeniden kurulum gerekir), kilit açılacak.\n' +
        'Devam edilsin mi? (y/N): ',
    )
  )
    .trim()
    .toLowerCase();
  return answer === 'y' || answer === 'yes' || answer === 'evet';
}

async function bootstrap(inp: BootstrapInput): Promise<{ password: string; reset: boolean }> {
  const prisma = new PrismaClient();
  try {
    const existing = await prisma.platformAdmin.findUnique({ where: { email: inp.email } });

    if (existing && !inp.forceUpdate && !NON_INTERACTIVE) {
      const rl = createInterface({ input, output });
      try {
        if (!(await confirmExisting(rl, existing.email))) {
          console.warn('İptal edildi.');
          exit(0);
        }
      } finally {
        rl.close();
      }
    }

    const password = inp.password || generateStrongPassword(16);
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

    await prisma.platformAdmin.upsert({
      where: { email: inp.email },
      update: {
        passwordHash,
        name: inp.name,
        role: inp.role,
        isActive: true,
        failedLoginCount: 0,
        lockedUntil: null,
        // Şifre sıfırlama = TOTP'yi de temizle (ilk login'de yeniden kurulur).
        totpSecret: null,
        totpVerifiedAt: null,
        passwordChangedAt: new Date(),
      },
      create: {
        email: inp.email,
        passwordHash,
        name: inp.name,
        role: inp.role,
        isActive: true,
      },
    });

    return { password, reset: Boolean(existing) };
  } finally {
    await prisma.$disconnect();
  }
}

function printSummary(inp: BootstrapInput, password: string, reset: boolean): void {
  const divider = '─'.repeat(60);
  console.warn(`\n${divider}`);
  console.warn(`🔐  Platform Admin ${reset ? 'SIFIRLANDI' : 'oluşturuldu'}`);
  console.warn(divider);
  console.warn(`   E-posta : ${inp.email}`);
  // #937 — Şifreyi yalnız OTOMATİK üretildiyse göster (kullanıcı zaten biliyorsa
  // stdout/log yakalamasında sızmasın).
  console.warn(`   Şifre   : ${inp.password ? '(sizin sağladığınız şifre)' : password}`);
  console.warn(`   Rol     : ${inp.role}`);
  console.warn(`   Panel   : ADMIN_ORIGIN (staging tailscale :8444) / admin.dnasoft.co (prod)`);
  console.warn(divider);
  console.warn('Bu şifre TEKRAR GÖSTERİLMEZ. Şimdi kopyalayın, güvenli kanaldan iletin.');
  console.warn(
    'İlk girişte TOTP (authenticator) kurulumu istenir; kurtarma kodları bir kez gösterilir.\n',
  );
}

async function main(): Promise<void> {
  console.warn('AirMed-HBYS — Platform Admin Bootstrap\n');
  const inp = await collectInput();
  const { password, reset } = await bootstrap(inp);
  printSummary(inp, password, reset);
}

main().catch((err: unknown) => {
  console.error('\n✗ Bootstrap başarısız:', err instanceof Error ? err.message : String(err));
  exit(1);
});
