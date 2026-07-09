import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ImageUp, Loader2, UserRound, X } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';
import { FormField } from '../form/FormField';
import { api } from '../../lib/api';
import { trpc } from '../../lib/trpc';
import { cn } from '../../lib/utils';

// #1050 — Hasta-facing doktor profil kartı (EPIC #1052). Foto + unvan +
// 3-dil bio + konuşulan diller + publicProfile anahtarı. KVKK sınırı:
// CV/dökümanlar bu sete ASLA girmez (StaffDocumentsSection ayrı, iç İK).
// Kaydet → doctor.update; yalnız action:doctor.update yetkisinde düzenlenebilir
// (yetkisiz rolde kart salt-okunur, butonlar GİZLİ — airmed-design).

const PHOTO_MIMES = ['image/png', 'image/jpeg', 'image/webp'];
const PHOTO_MAX_BYTES = 2 * 1024 * 1024;

const BIO_LOCALES = ['tr', 'ru', 'tg'] as const;
type BioLocale = (typeof BIO_LOCALES)[number];
type Bio = Partial<Record<BioLocale, string>>;

interface DoctorProfileData {
  id: string;
  title: string | null;
  bio: Bio | null;
  languages: string[];
  publicProfile: boolean;
  photoKey: string | null;
}

export function DoctorPublicProfileCard({
  doctor,
  canEdit,
}: {
  doctor: DoctorProfileData;
  canEdit: boolean;
}) {
  const { t, i18n } = useTranslation('doctor');
  const utils = trpc.useUtils();

  const [title, setTitle] = useState(doctor.title ?? '');
  const [bio, setBio] = useState<Bio>(doctor.bio ?? {});
  const [languages, setLanguages] = useState<string[]>(doctor.languages ?? []);
  const [publicProfile, setPublicProfile] = useState(doctor.publicProfile);
  const [bioTab, setBioTab] = useState<BioLocale>('tr');
  const [langDraft, setLangDraft] = useState('');

  useEffect(() => {
    setTitle(doctor.title ?? '');
    setBio(doctor.bio ?? {});
    setLanguages(doctor.languages ?? []);
    setPublicProfile(doctor.publicProfile);
  }, [doctor.id, doctor.title, doctor.bio, doctor.languages, doctor.publicProfile]);

  const updateMut = trpc.doctor.update.useMutation({
    onSuccess: async () => {
      toast.success(t('publicProfile.saved'));
      await utils.doctor.findById.invalidate({ id: doctor.id });
    },
    onError: (err) => toast.error(err.message),
  });

  const addLanguage = () => {
    const value = langDraft.trim().replace(/,+$/, '');
    if (value.length < 2) return;
    if (!languages.includes(value) && languages.length < 10) {
      setLanguages((prev) => [...prev, value]);
    }
    setLangDraft('');
  };

  const save = () =>
    updateMut.mutate({
      id: doctor.id,
      data: {
        title: title.trim() === '' ? null : title.trim(),
        bio,
        languages,
        publicProfile,
      },
    });

  // Salt-okunur görünüm: hasta tarafına ne gittiğini herkes görebilir, ama
  // düzenleme kontrolleri yetkisiz rolde hiç render edilmez.
  if (!canEdit) {
    const activeLocale = (
      BIO_LOCALES.includes(i18n.language as BioLocale) ? i18n.language : 'tr'
    ) as BioLocale;
    return (
      <section className="space-y-3 rounded-lg border bg-background p-4">
        <CardHeader publicProfile={doctor.publicProfile} />
        <div className="flex flex-wrap items-start gap-4">
          <DoctorPhoto doctorId={doctor.id} photoKey={doctor.photoKey} />
          <div className="min-w-0 flex-1 space-y-2 text-sm">
            <p className="font-medium">{doctor.title ?? '—'}</p>
            <p className="whitespace-pre-wrap text-muted-foreground">
              {doctor.bio?.[activeLocale] ?? '—'}
            </p>
            {doctor.languages.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {doctor.languages.map((lang) => (
                  <Badge key={lang} variant="outline">
                    {lang}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-lg border bg-background p-4">
      <CardHeader publicProfile={publicProfile} />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <DoctorPhotoUpload doctorId={doctor.id} photoKey={doctor.photoKey} />
        <div className="min-w-0 flex-1 space-y-4">
          <FormField label={t('publicProfile.titleField')}>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('publicProfile.titlePlaceholder')}
              maxLength={100}
            />
          </FormField>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{t('publicProfile.bio')}</span>
              <div className="flex gap-1" role="tablist">
                {BIO_LOCALES.map((l) => (
                  <button
                    key={l}
                    type="button"
                    role="tab"
                    aria-selected={bioTab === l}
                    onClick={() => setBioTab(l)}
                    className={cn(
                      'rounded-md border px-2 py-1 text-xs font-medium uppercase transition-colors',
                      bioTab === l
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-muted',
                    )}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <textarea
              className="focus-ring min-h-24 w-full rounded-lg border border-field bg-background px-3 py-2 text-sm hover:border-field-hover"
              value={bio[bioTab] ?? ''}
              maxLength={2000}
              onChange={(e) => setBio((prev) => ({ ...prev, [bioTab]: e.target.value }))}
              placeholder={t('publicProfile.bioHint')}
            />
          </div>

          <div className="space-y-2">
            <span className="text-sm font-medium">{t('publicProfile.languages')}</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {languages.map((lang) => (
                <span
                  key={lang}
                  className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2.5 py-0.5 text-xs font-medium"
                >
                  {lang}
                  <button
                    type="button"
                    aria-label={t('publicProfile.removeLanguage')}
                    onClick={() => setLanguages((prev) => prev.filter((x) => x !== lang))}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3 w-3" aria-hidden />
                  </button>
                </span>
              ))}
              <Input
                value={langDraft}
                onChange={(e) => setLangDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    addLanguage();
                  }
                }}
                onBlur={addLanguage}
                placeholder={t('publicProfile.languagesPlaceholder')}
                className="h-8 w-48 text-xs"
                maxLength={30}
              />
            </div>
          </div>

          <label className="flex items-start gap-3">
            <Switch
              checked={publicProfile}
              onCheckedChange={setPublicProfile}
              data-testid="public-profile-switch"
            />
            <span className="text-sm">
              <span className="font-medium">{t('publicProfile.publicSwitch')}</span>
              <span className="block text-xs text-muted-foreground">
                {t('publicProfile.description')}
              </span>
            </span>
          </label>

          <div className="flex justify-end">
            <Button type="button" size="sm" onClick={save} disabled={updateMut.isPending}>
              {updateMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
              {t('publicProfile.save')}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function CardHeader({ publicProfile }: { publicProfile: boolean }) {
  const { t } = useTranslation('doctor');
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-medium">{t('publicProfile.title')}</h3>
      <Badge variant={publicProfile ? 'success' : 'secondary'}>
        {publicProfile ? t('publicProfile.statusOn') : t('publicProfile.statusOff')}
      </Badge>
    </div>
  );
}

/**
 * Foto önizleme — auth'lu blob (düz <img src> Authorization taşımaz, 401).
 * photoKey değişince yeniden çekilir; objectURL unmount'ta serbest bırakılır.
 */
function useDoctorPhotoUrl(doctorId: string, photoKey: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!photoKey) {
      setUrl(null);
      return;
    }
    let objectUrl: string | null = null;
    let cancelled = false;
    void api
      .get(`/doctors/${doctorId}/photo/file`, { responseType: 'blob' })
      .then((res) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(res.data as Blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [doctorId, photoKey]);

  return url;
}

function DoctorPhoto({ doctorId, photoKey }: { doctorId: string; photoKey: string | null }) {
  const url = useDoctorPhotoUrl(doctorId, photoKey);
  return (
    <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted/30">
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <UserRound className="h-8 w-8 text-muted-foreground" aria-hidden />
      )}
    </div>
  );
}

function DoctorPhotoUpload({ doctorId, photoKey }: { doctorId: string; photoKey: string | null }) {
  const { t } = useTranslation('doctor');
  const utils = trpc.useUtils();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const url = useDoctorPhotoUrl(doctorId, photoKey);

  const acceptList = useMemo(() => PHOTO_MIMES.join(','), []);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!PHOTO_MIMES.includes(file.type.toLowerCase())) {
      toast.error(t('publicProfile.photoMimeError'));
      return;
    }
    if (file.size > PHOTO_MAX_BYTES) {
      toast.error(t('publicProfile.photoSizeError'));
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api.post(`/doctors/${doctorId}/photo`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success(t('publicProfile.photoUploaded'));
      // photoKey değişimi findById üzerinden gelir → useDoctorPhotoUrl yeniden çeker
      await utils.doctor.findById.invalidate({ id: doctorId });
    } catch (err: unknown) {
      const e2 = err as { response?: { data?: { message?: string } }; message?: string };
      toast.error(e2.response?.data?.message ?? e2.message ?? t('publicProfile.photoError'));
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="flex shrink-0 flex-col items-center gap-2">
      <div className="relative flex h-24 w-24 items-center justify-center overflow-hidden rounded-lg border bg-muted/30">
        {url ? (
          <img src={url} alt="" className="h-full w-full object-cover" />
        ) : (
          <UserRound className="h-8 w-8 text-muted-foreground" aria-hidden />
        )}
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/60">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
          </div>
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept={acceptList}
        onChange={(e) => void handleFile(e)}
        className="hidden"
        data-testid="doctor-photo-input"
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => fileInputRef.current?.click()}
        disabled={busy}
      >
        <ImageUp className="mr-2 h-4 w-4" aria-hidden />
        {url ? t('publicProfile.photoReplace') : t('publicProfile.photoUpload')}
      </Button>
      <p className="max-w-[9rem] text-center text-[11px] leading-tight text-muted-foreground">
        {t('publicProfile.photoHint')}
      </p>
    </div>
  );
}
