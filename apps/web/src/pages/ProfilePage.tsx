import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { FormField } from '../components/form/FormField';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { trpc } from '../lib/trpc';
import { api } from '../lib/api';
import { mapTrpcError } from '../lib/trpc-error';
import { useLocale } from '../providers/LocaleProvider';
import type { SupportedLocale } from '../i18n';

// #1051 — Self-service profil. Kullanıcı YALNIZ kendini görür; telefon + dil
// düzenleyebilir (ad/rol/mod yönetici-kontrollü). Doktor kullanıcı kendi
// hasta-facing profilini (foto/unvan/bio/diller) READ-ONLY görür — düzenleme
// yönetici tarafında (DoctorDetailPage), airmed-design "yapamıyorsa gizli/
// açıklamalı" rayı.

const LOCALE_OPTIONS: SupportedLocale[] = ['tr', 'ru', 'tg'];

function pickBio(bio: unknown, locale: string): string | null {
  if (!bio || typeof bio !== 'object') return null;
  const b = bio as Record<string, string | undefined>;
  const text = b[locale]?.trim() || b.tr?.trim() || b.ru?.trim() || b.tg?.trim();
  return text && text.length > 0 ? text : null;
}

export function ProfilePage() {
  const { t } = useTranslation(['common', 'doctor']);
  const { locale, setLocale } = useLocale();
  const utils = trpc.useUtils();
  const me = trpc.user.me.useQuery();

  const [phone, setPhone] = useState('');
  const [phoneDirty, setPhoneDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  // me yüklenince telefon alanını doldur (kullanıcı henüz düzenlemediyse).
  useEffect(() => {
    if (me.data && !phoneDirty) setPhone(me.data.phone ?? '');
  }, [me.data, phoneDirty]);

  // Doktor profil fotosu authlu blob (düz <img src> 401 verir — Bearer taşımaz).
  const doctorId = me.data?.doctor?.id;
  const hasPhoto = !!me.data?.doctor?.photoKey;
  useEffect(() => {
    if (!doctorId || !hasPhoto) return;
    let revoked = false;
    let url: string | null = null;
    void api
      .get(`/doctors/${doctorId}/photo/file`, { responseType: 'blob' })
      .then((res) => {
        if (revoked) return;
        url = URL.createObjectURL(res.data as Blob);
        setPhotoUrl(url);
      })
      .catch(() => undefined);
    return () => {
      revoked = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [doctorId, hasPhoto]);

  const updateMe = trpc.user.updateMe.useMutation({
    onSuccess: async () => {
      setSaveError(null);
      setPhoneDirty(false);
      await utils.user.me.invalidate();
    },
    onError: (err) => setSaveError(mapTrpcError(err, t)),
  });

  if (me.isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!me.data) {
    return <p className="p-4 text-sm text-destructive">{t('common:profile.loadError')}</p>;
  }

  const u = me.data;
  const doctorBio = u.doctor ? pickBio(u.doctor.bio, locale) : null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title={t('common:profile.title')} description={t('common:profile.description')} />

      {/* Kimlik — read-only */}
      <section className="space-y-3 rounded-md border bg-card p-4">
        <h2 className="text-sm font-semibold text-muted-foreground">
          {t('common:profile.identity')}
        </h2>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">{t('common:profile.name')}</dt>
          <dd className="font-medium">{u.name}</dd>
          <dt className="text-muted-foreground">{t('common:profile.email')}</dt>
          <dd className="font-medium">{u.email}</dd>
          <dt className="text-muted-foreground">{t('common:profile.roles')}</dt>
          <dd className="flex flex-wrap gap-1">
            {u.roles.map((r) => (
              <span key={r.key} className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                {r.label}
              </span>
            ))}
          </dd>
          {u.mode && (
            <>
              <dt className="text-muted-foreground">{t('common:profile.mode')}</dt>
              <dd className="font-medium">
                {t(`common:profile.modes.${u.mode}`, { defaultValue: u.mode })}
              </dd>
            </>
          )}
        </dl>
      </section>

      {/* Telefon + dil — düzenlenebilir */}
      <section className="space-y-4 rounded-md border bg-card p-4">
        <h2 className="text-sm font-semibold text-muted-foreground">
          {t('common:profile.editable')}
        </h2>
        <FormField label={t('common:profile.phone')}>
          <Input
            id="profile-phone"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              setPhoneDirty(true);
            }}
            maxLength={30}
            placeholder={t('common:profile.phonePlaceholder') ?? ''}
          />
        </FormField>
        {saveError && <p className="text-sm text-destructive">{saveError}</p>}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <label htmlFor="profile-locale" className="text-sm text-muted-foreground">
              {t('common:locale.label')}
            </label>
            <select
              id="profile-locale"
              value={locale}
              onChange={(e) => void setLocale(e.target.value as SupportedLocale)}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              {LOCALE_OPTIONS.map((code) => (
                <option key={code} value={code}>
                  {t(`common:locale.${code}`)}
                </option>
              ))}
            </select>
          </div>
          <Button
            size="sm"
            disabled={!phoneDirty || updateMe.isPending}
            onClick={() => updateMe.mutate({ phone: phone.trim() || null })}
          >
            {updateMe.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            {t('common:actions.save')}
          </Button>
        </div>
        <div className="border-t pt-3">
          <Link to="/change-password" className="text-sm text-primary hover:underline">
            {t('common:user.changePassword')}
          </Link>
        </div>
      </section>

      {/* Doktor: kendi hasta-facing profili — READ ONLY */}
      {u.doctor && (
        <section className="space-y-3 rounded-md border bg-card p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-muted-foreground">
              {t('doctor:publicProfile.selfHeading')}
            </h2>
            <span
              className={
                'rounded-full px-2 py-0.5 text-xs font-medium ' +
                (u.doctor.publicProfile
                  ? 'bg-success-bg text-success-foreground'
                  : 'bg-muted text-muted-foreground')
              }
            >
              {u.doctor.publicProfile
                ? t('doctor:publicProfile.statusPublished')
                : t('doctor:publicProfile.statusHidden')}
            </span>
          </div>
          <div className="flex gap-4">
            {photoUrl && (
              <img
                src={photoUrl}
                alt={u.name}
                className="h-20 w-20 shrink-0 rounded-full object-cover"
              />
            )}
            <dl className="min-w-0 flex-1 space-y-1 text-sm">
              {u.doctor.title && (
                <div>
                  <dt className="inline text-muted-foreground">
                    {t('doctor:publicProfile.titleField')}:{' '}
                  </dt>
                  <dd className="inline font-medium">{u.doctor.title}</dd>
                </div>
              )}
              {u.doctor.languages.length > 0 && (
                <div>
                  <dt className="inline text-muted-foreground">
                    {t('doctor:publicProfile.languages')}:{' '}
                  </dt>
                  <dd className="inline">{u.doctor.languages.join(', ')}</dd>
                </div>
              )}
              {doctorBio && (
                <p className="whitespace-pre-wrap text-muted-foreground">{doctorBio}</p>
              )}
            </dl>
          </div>
          <p className="text-xs text-muted-foreground">{t('doctor:publicProfile.selfEditNote')}</p>
        </section>
      )}
    </div>
  );
}
