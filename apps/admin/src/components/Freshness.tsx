import { useI18n } from '../i18n';

// #1092 — Metrik tazelik damgası. Sampler 5 dk'da bir örnekler (#1085) → veri
// her zaman 0-5 dk eskidir; restart sonrası ilk örnek boot+5dk'da düşer. Bu
// satır "ne kadar eski" olduğunu açıkça gösterir (kafa karışıklığını önler).
export function Freshness({ capturedAt }: { capturedAt?: string | null }) {
  const { t } = useI18n();
  if (!capturedAt) return null;
  const ts = new Date(capturedAt);
  const ageMin = Math.max(0, Math.round((Date.now() - ts.getTime()) / 60_000));
  const stale = ageMin > 10; // 2 örnek aralığı geçtiyse dikkat çek
  return (
    <p
      className={
        'text-xs ' + (stale ? 'font-medium text-[var(--warn-tx)]' : 'text-muted-foreground')
      }
      data-testid="freshness"
    >
      {t('monitoring.lastUpdated', {
        time: ts.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
        age: ageMin,
      })}
      {stale ? ` — ${t('monitoring.staleHint')}` : ''}
    </p>
  );
}
