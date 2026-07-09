// Makbuz tahsilat sonrası otomatik yazdırma tercihi.
// localStorage'da, tarayıcı/cihaz bazlı saklanır — backend tarafına
// taşıma gerekirse Tenant.receiptAutoprint kolonuna migrate edilir.

import { api } from './api';

const STORAGE_KEY = 'reception.receiptAutoprint';

export type ReceiptAutoprintMode = 'auto' | 'manual';

const DEFAULT: ReceiptAutoprintMode = 'auto';

export function getReceiptAutoprintMode(): ReceiptAutoprintMode {
  if (typeof window === 'undefined') return DEFAULT;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw === 'manual' ? 'manual' : 'auto';
}

export function setReceiptAutoprintMode(mode: ReceiptAutoprintMode): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, mode);
}

/**
 * Makbuz PDF'ini authlu axios ile blob olarak çeker. Doğrudan
 * `/api/billing/.../receipt.pdf` adresini yeni sekmede / anchor ile açmak 401
 * verir: erişim token'ı bellekte tutulur (Authorization header'ı yalnız
 * interceptor'lı isteklere eklenir) ve refresh cookie'si `/api/auth` path'ine
 * kısıtlıdır — düz tarayıcı navigasyonu hiçbir kimlik bilgisi taşımaz. PDF'i
 * burada `api` ile çekip blob URL'e çevirince Bearer header + 401→refresh
 * retry zinciri devreye girer.
 */
async function fetchReceiptBlobUrl(invoiceId: string): Promise<string> {
  const res = await api.get(`/billing/invoices/${invoiceId}/receipt.pdf`, {
    responseType: 'blob',
  });
  return URL.createObjectURL(res.data as Blob);
}

/**
 * Auto (tahsilat sonrası): gizli iframe ile tarayıcı print diyaloğunu açar.
 * `window.open` kullanılmaz → popup blocker ve yeni-sekme 401 sorunları olmaz.
 */
export async function printReceipt(invoiceId: string): Promise<void> {
  const blobUrl = await fetchReceiptBlobUrl(invoiceId);
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  iframe.src = blobUrl;
  iframe.addEventListener('load', () => {
    const win = iframe.contentWindow;
    try {
      win?.focus();
      win?.print();
    } catch {
      /* tarayıcı PDF print'i engellerse sessiz geç */
    }
    win?.addEventListener('afterprint', () => {
      URL.revokeObjectURL(blobUrl);
      iframe.remove();
    });
  });
  document.body.appendChild(iframe);
}

/**
 * Manual / indir: PDF'i yeni sekmede açar. Kullanıcı jesti içinde çağrılmalı —
 * popup slotunu senkron alır, blob hazır olunca yönlendirir.
 */
export function openReceiptPdf(invoiceId: string, onError?: () => void): void {
  const tab = window.open('', '_blank');
  void fetchReceiptBlobUrl(invoiceId).then(
    (blobUrl) => {
      if (tab) tab.location.href = blobUrl;
      else onError?.();
    },
    () => {
      tab?.close();
      onError?.();
    },
  );
}
