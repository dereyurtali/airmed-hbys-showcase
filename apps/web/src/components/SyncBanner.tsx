import { CloudOff, AlertTriangle, RefreshCw } from 'lucide-react';
import { useSyncStatus } from '../hooks/useSyncStatus';

// A12 PR 5 — Offline / sync queue banner.
//
// Görünme koşulları (precedence):
// 1. offline (network error 30 sn polling fail) → kırmızı bar
// 2. outboxFailed > 0 → sarı bar (dead-letter, manuel müdahale)
// 3. outboxPending > 5 VE peerConfigured → sarı bar (queue birikiyor, peer'a
//    iletilemiyor). Peer set up edilmemiş bir kurulumda (örn. yeni klinik,
//    cloud peer henüz tanıtılmamış) outbox normal olarak birikir ama sync
//    hiç denenmez → "bekliyor" demek kullanıcıyı yanıltır.
// 4. lastSyncAt > 10 dk önce VE peerConfigured → soluk bar (geç sync uyarısı)
// 5. Else: render etmez

function minutesAgo(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
}

export function SyncBanner() {
  const { status, offline, isLoading } = useSyncStatus();
  if (isLoading) return null;
  if (!status && !offline) return null;

  // 1. Network kopuk
  if (offline) {
    return (
      <div
        data-testid="sync-banner-offline"
        role="status"
        aria-live="polite"
        className="border-b border-red-700 bg-red-600 px-4 py-2 text-sm text-white"
      >
        <div className="flex items-center gap-2">
          <CloudOff className="h-4 w-4" aria-hidden />
          <span>
            <strong>Çevrimdışı.</strong> Backend'e erişilemiyor; girişleriniz lokal kayıtlı.
            Bağlantı tekrar açıldığında otomatik sync edilecek.
          </span>
        </div>
      </div>
    );
  }

  if (!status) return null;

  // 2. Dead-letter (manuel müdahale gerek)
  if (status.outboxFailed > 0) {
    return (
      <div
        data-testid="sync-banner-failed"
        role="alert"
        className="border-b border-amber-700 bg-amber-500 px-4 py-2 text-sm text-amber-950"
      >
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" aria-hidden />
          <span>
            <strong>{status.outboxFailed} sync hatası</strong> 5+ deneme sonrası dead-letter'a
            düştü. Platform admin'e bildirin.
          </span>
        </div>
      </div>
    );
  }

  // 3. Queue birikiyor (peer yoksa biriken normal — uyarma)
  if (status.outboxPending > 5 && status.peerConfigured) {
    return (
      <div
        data-testid="sync-banner-pending"
        role="status"
        className="border-b border-amber-600 bg-amber-100 px-4 py-2 text-xs text-amber-900"
      >
        <div className="flex items-center gap-2">
          <RefreshCw className="h-4 w-4" aria-hidden />
          <span>
            {status.outboxPending} kayıt sync bekliyor. Bağlantı yavaş olabilir; otomatik yeniden
            denenecek.
          </span>
        </div>
      </div>
    );
  }

  // 4. Geç sync (10dk+)
  const mins = minutesAgo(status.lastSyncAt);
  if (mins !== null && mins > 10 && status.peerConfigured) {
    return (
      <div
        data-testid="sync-banner-stale"
        role="status"
        className="border-b border-slate-300 bg-muted px-4 py-1.5 text-xs text-muted-foreground"
      >
        <div className="flex items-center gap-2">
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          <span>Son sync {mins} dk önce. Bağlantı kontrol ediliyor.</span>
        </div>
      </div>
    );
  }

  return null;
}
