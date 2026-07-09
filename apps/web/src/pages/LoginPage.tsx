import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Navigate, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { AlertCircle, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { TRPCClientError } from '@trpc/client';
import { BRAND_GRADIENT, BRAND_MESH_BACKGROUND } from '../lib/brand';
import { FormField } from '../components/form/FormField';
import { LocaleSwitcher } from '../components/layout/LocaleSwitcher';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { api } from '../lib/api';
import { resolveTenantSlug } from '../lib/tenant';
import { trpc } from '../lib/trpc';
import { APP_VERSION_LABEL } from '../lib/version';
import { useAuth } from '../providers/AuthProvider';

// v0.4.2 — Login "Quiet Split, Single Task" kanonu (airmed-design §24.2 + Bölüm
// 12; görsel kanon docs/mockups/airmed-tasarim-sistemi.html). Sol panel: marka
// gradient + 11px mesh + MONOKROM BEYAZ logo + tagline (büyük başlık yok; logo
// zaten wordmark). Sağ panel: tek görev kartı, ikonsuz birincil buton, read-only
// klinik-kodu dolu nötr zemin. Sürüm package.json'dan otomatik (lib/version).
// Test-id sözleşmesi (login-form/tenant/email/password/submit/error/mode-*) korunur.

export function LoginPage() {
  const { t } = useTranslation(['auth', 'common']);
  const { applyAuthState, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [submitError, setSubmitError] = useState<string | null>(null);
  // v0.4 (#540) — Birden çok çalışma moduna yetkili kullanıcıda giriş iki fazlı:
  // ilk submit kimlik doğrular, backend `needsModeSelection` döner → mod seçici
  // çıkar; seçim aynı kimlikle modu ekleyip tekrar gönderir. Tek/sıfır modda
  // seçici hiç görünmez (sessiz geçiş).
  const [modeSelection, setModeSelection] = useState<{ availableModes: string[] } | null>(null);
  // Tenant slug DB'den (tek-tenant klinik kutusu = kanonik kaynak). Subdomain'e
  // tercih edilir; staging Tailscale host'u / klinik LAN adresi tenant'la eşleşmez.
  const [dbTenantSlug, setDbTenantSlug] = useState<string | null>(null);
  // #1093 — aktif bakım penceresi mesajı (setup/status'tan).
  const [maintenance, setMaintenance] = useState<{ message: string } | null>(null);

  // Boş DB durumunda /setup'a yönlendir. ProtectedRoute zaten unauthenticated
  // user'ı /login'e atıyor; biz de buradan setup'a iletiyoruz. Tek noktada
  // check yeterli — App.tsx'i karmaşıklaştırmıyoruz. Aynı çağrı tenant slug'ı da getirir.
  useEffect(() => {
    if (isAuthenticated) return;
    let cancelled = false;
    api
      .get<{
        needsSetup: boolean;
        tenant: { slug: string } | null;
        maintenance: { message: string } | null;
      }>('/setup/status')
      .then((res) => {
        if (cancelled) return;
        if (res.data.needsSetup) {
          navigate('/setup', { replace: true });
          return;
        }
        if (res.data.tenant?.slug) setDbTenantSlug(res.data.tenant.slug);
        if (res.data.maintenance) setMaintenance(res.data.maintenance);
      })
      .catch(() => {
        // Status fetch hata verirse login formunu göstermeye devam et.
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, navigate]);

  const loginSchema = z.object({
    tenantSlug: z
      .string()
      .min(2, t('auth:login.validation.tenantMin'))
      .max(63)
      .regex(/^[a-z0-9-]+$/, t('auth:login.validation.tenantPattern')),
    email: z.string().email(t('auth:login.validation.emailInvalid')),
    password: z.string().min(8, t('auth:login.validation.passwordMin')),
  });

  type LoginFormValues = z.infer<typeof loginSchema>;

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: (data) => {
      // İki fazlı giriş: backend mod seçimi istiyorsa token gelmez; seçiciyi aç.
      if ('needsModeSelection' in data) {
        setModeSelection({ availableModes: data.availableModes });
        return;
      }
      applyAuthState(data.accessToken, data.mustChangePassword);
      // "/" → HomeRedirect rol-bazlı açılışı seçer (doktor→worklist,
      // resepsiyon→reception-queue, ölçüm hemşiresi→measurement-queue, diğer→
      // dashboard). Sabit "/dashboard" kilitli rolleri /forbidden'a düşürürdü.
      navigate('/', { replace: true });
    },
    onError: (err) => {
      setSubmitError(err instanceof TRPCClientError ? err.message : t('auth:login.errorFallback'));
    },
  });

  // Başlangıç değeri subdomain'den (ya da dev fallback). DB yanıtı gelince
  // (tek-tenant kutu) aşağıdaki effect bunu kanonik slug ile değiştirir. Alan
  // read-only kalır: doğru slug DB'den geldiği için staff yine teyit edebilir.
  const detectedTenantSlug = resolveTenantSlug();

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { tenantSlug: detectedTenantSlug, email: '', password: '' },
  });

  // DB'den gelen tenant slug'ı forma yaz — klinik-primary modelde kutu tek tenant'lı,
  // dolayısıyla URL'den çıkarım yerine backend kaynaklı slug kanonik.
  useEffect(() => {
    if (dbTenantSlug) form.setValue('tenantSlug', dbTenantSlug);
  }, [dbTenantSlug, form]);

  if (isAuthenticated) return <Navigate to="/" replace />;

  const onSubmit = form.handleSubmit((values) => {
    setSubmitError(null);
    loginMutation.mutate(values);
  });

  // Mod seçilince aynı kimlikle (form değerleri hâlâ duruyor) modu ekleyip
  // tekrar gönder. Başarılı yanıtta token gelir → onSuccess oturumu açar.
  const selectMode = (mode: string) => {
    setSubmitError(null);
    loginMutation.mutate({ ...form.getValues(), mode });
  };

  // Mod etiketi i18n; bilinmeyen mod için ham anahtar fallback.
  const modeLabel = (mode: string) => t(`auth:login.modes.${mode}`, { defaultValue: mode });

  const isSubmitting = loginMutation.isPending;

  // Sürüm numarası package.json'dan (lib/version); kanal etiketi ("Demo")
  // çevrilebilir i18n. Sürüm string'i i18n'de DEĞİL → bump otomatik yansır.
  const channel = t('common:app.versionChannel', { defaultValue: '' });
  const versionLabel = channel ? `${APP_VERSION_LABEL} · ${channel}` : APP_VERSION_LABEL;

  return (
    <div className="min-h-screen bg-muted/30 lg:grid lg:grid-cols-[40%_60%]">
      {/* Sol panel — "Quiet Split" marka yüzeyi (§24.2). 40% genişlik; gradient +
          11px mesh + monokrom beyaz logo + tagline. Mobilde gizli. */}
      <aside
        className={`relative hidden overflow-hidden text-white lg:flex lg:flex-col lg:p-12 ${BRAND_GRADIENT}`}
      >
        {/* İnce diagonal trama (11px) — markalı sidebar header'la birebir aynı doku */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.10]"
          style={{ backgroundImage: BRAND_MESH_BACKGROUND }}
        />

        {/* Merkez kompozisyon — logo wordmark + tagline (büyük başlık yok; logo
            zaten "AirMed HBYS"). Dikey merkez aksına ortalanmış. */}
        <div className="relative flex flex-1 flex-col items-center justify-center text-center">
          {/* Monokrom beyaz logo — brightness(0) invert(1) ile gradient üstünde
              tek-renk beyaz (Bölüm 12 kanonu; turuncu marka koyu yüzeyde kullanılmaz). */}
          <img
            src="/airmed-logo-light.png"
            alt="AirMed"
            className="h-16 w-auto select-none [filter:brightness(0)_invert(1)] xl:h-20"
            draggable={false}
          />

          <p className="mt-6 max-w-xs text-base leading-relaxed text-white/70">
            {t('common:app.tagline')}
          </p>
        </div>

        <div className="relative flex items-center justify-between text-xs text-white/55">
          <span>{t('common:app.footer')}</span>
          <span className="font-medium tracking-wide text-white/70">{versionLabel}</span>
        </div>
      </aside>

      {/* Sağ panel — kart-bazlı form (rounded-xl border bg-background, diğer
          v0.3 ekranlarıyla aynı yüzey dili). */}
      <main className="flex min-h-screen items-center justify-center p-6 lg:p-10">
        <div className="w-full max-w-md space-y-5">
          {/* #1093 — aktif bakım penceresi uyarısı (dismiss-siz, dikkat çekici). */}
          {maintenance && (
            <div
              role="alert"
              data-testid="login-maintenance"
              className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
            >
              <div className="font-semibold">{t('auth:login.maintenanceTitle')}</div>
              <div className="mt-0.5">{maintenance.message}</div>
            </div>
          )}
          <div className="flex items-center justify-between">
            {/* Mobilde marka — turuncu kare + AirMed yazılı orijinal logo
                yatay olarak gösterilir (lg üstünde sol panel zaten gösteriyor). */}
            <img
              src="/airmed-logo.png"
              alt="AirMed"
              className="h-7 w-auto select-none lg:hidden"
              draggable={false}
            />
            <div className="ml-auto">
              <LocaleSwitcher />
            </div>
          </div>

          {modeSelection ? (
            <div
              className="rounded-xl border bg-background p-6 shadow-sm sm:p-8"
              data-testid="login-mode-select"
            >
              <header className="space-y-1.5">
                <h2 className="text-xl font-semibold tracking-tight">
                  {t('auth:login.modeSelect.title')}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {t('auth:login.modeSelect.subtitle')}
                </p>
              </header>

              <div className="mt-6 space-y-3">
                {modeSelection.availableModes.map((mode) => (
                  <Button
                    key={mode}
                    type="button"
                    variant="outline"
                    className="h-12 w-full justify-start text-base"
                    disabled={isSubmitting}
                    data-testid={`login-mode-${mode}`}
                    onClick={() => selectMode(mode)}
                  >
                    {modeLabel(mode)}
                    {/* §24.2: mod seçiminde yüklenirken spinner SAĞDA. */}
                    {isSubmitting && (
                      <Loader2 className="ml-auto h-4 w-4 animate-spin" strokeWidth={1.5} />
                    )}
                  </Button>
                ))}

                {submitError && (
                  <div
                    role="alert"
                    data-testid="login-error"
                    className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                  >
                    <AlertCircle
                      className="mt-0.5 h-4 w-4 shrink-0"
                      strokeWidth={1.5}
                      aria-hidden
                    />
                    <span className="leading-snug">{submitError}</span>
                  </div>
                )}

                {/* §24.2: "Geri" ghost buton. */}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={() => {
                    setModeSelection(null);
                    setSubmitError(null);
                  }}
                >
                  {t('auth:login.modeSelect.back')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border bg-background p-6 shadow-sm sm:p-8">
              <header className="space-y-1.5">
                <h2 className="text-xl font-semibold tracking-tight">{t('auth:login.title')}</h2>
                <p className="text-sm text-muted-foreground">{t('auth:login.subtitle')}</p>
              </header>

              <form
                onSubmit={onSubmit}
                className="mt-6 space-y-4"
                noValidate
                data-testid="login-form"
              >
                {/* §24.2: read-only "Klinik kodu" = dolu nötr zemin (Input'un
                    yerleşik readOnly stili = var(--ro) #F1F3F6; disabled/kilit
                    görünümü DEĞİL). 44px (izole auth yüzeyi). */}
                <FormField
                  label={t('auth:login.tenantLabel')}
                  description={t('auth:login.tenantHint')}
                  error={form.formState.errors.tenantSlug?.message}
                >
                  <Input
                    readOnly
                    autoComplete="organization"
                    className="h-11"
                    data-testid="login-tenant"
                    {...form.register('tenantSlug')}
                  />
                </FormField>

                <FormField
                  label={t('auth:login.emailLabel')}
                  required
                  error={form.formState.errors.email?.message}
                >
                  <Input
                    type="email"
                    autoFocus
                    autoComplete="username"
                    className="h-11"
                    error={!!form.formState.errors.email}
                    data-testid="login-email"
                    {...form.register('email')}
                  />
                </FormField>

                <FormField
                  label={t('auth:login.passwordLabel')}
                  required
                  error={form.formState.errors.password?.message}
                >
                  <Input
                    type="password"
                    autoComplete="current-password"
                    className="h-11"
                    error={!!form.formState.errors.password}
                    data-testid="login-password"
                    {...form.register('password')}
                  />
                </FormField>

                {submitError && (
                  <div
                    role="alert"
                    data-testid="login-error"
                    className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                  >
                    <AlertCircle
                      className="mt-0.5 h-4 w-4 shrink-0"
                      strokeWidth={1.5}
                      aria-hidden
                    />
                    <span className="leading-snug">{submitError}</span>
                  </div>
                )}

                {/* §24.2/§24.4: izole auth yüzeyi → 44px birincil buton, ikonsuz
                    marine; loading = etiket kalır + sol spinner (text değişmez,
                    i18n bug riski — §6). */}
                <Button
                  type="submit"
                  size="touch"
                  className="w-full"
                  disabled={isSubmitting}
                  data-testid="login-submit"
                >
                  {isSubmitting && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" strokeWidth={1.5} />
                  )}
                  {t('auth:login.submit')}
                </Button>
              </form>
            </div>
          )}

          <p className="text-center text-xs text-muted-foreground lg:hidden">
            {t('common:app.footer')} · {versionLabel}
          </p>
        </div>
      </main>
    </div>
  );
}
