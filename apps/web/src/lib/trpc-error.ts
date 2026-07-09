// SİS-1 — Merkezi tRPC hata → i18n çeviri helper'ı.
//
// Sorun: 50+ noktada `toast.error(err.message)` ham backend metnini (çoğu
// TR hardcoded) basıyordu; RU/TG personel anlamadığı dilde hata görüyordu.
//
// Çözüm: tek `mapTrpcError(err, t)`:
//   1. Backend `messageKey` (+ `messageParams`) gönderdiyse → klinik-spesifik
//      çeviri (örn. 3-hasta cap, ilaç çakışması). Önceliklidir.
//   2. Bilinen tRPC kodu (FORBIDDEN/CONFLICT/BAD_REQUEST/...) → genel çeviri.
//   3. Bilinmeyen → `errors.unexpected`.

import type { TFunction } from 'i18next';

const CODE_TO_KEY: Record<string, string> = {
  FORBIDDEN: 'errors.code.forbidden',
  UNAUTHORIZED: 'errors.code.unauthorized',
  CONFLICT: 'errors.code.conflict',
  BAD_REQUEST: 'errors.code.badRequest',
  NOT_FOUND: 'errors.code.notFound',
  TIMEOUT: 'errors.code.timeout',
  TOO_MANY_REQUESTS: 'errors.code.tooManyRequests',
  PRECONDITION_FAILED: 'errors.code.preconditionFailed',
  PAYLOAD_TOO_LARGE: 'errors.code.payloadTooLarge',
  UNPROCESSABLE_CONTENT: 'errors.code.badRequest',
  INTERNAL_SERVER_ERROR: 'errors.unexpected',
};

interface TrpcErrorData {
  code?: string;
  messageKey?: string;
  messageParams?: Record<string, unknown>;
}

// TRPCClientError, hata verisini `err.data` (errorFormatter shape) altında
// taşır. Farklı yollardan gelen hatalar için savunmacı okuma.
function extractData(err: unknown): TrpcErrorData | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const data = (err as { data?: unknown }).data;
  if (data && typeof data === 'object') return data as TrpcErrorData;
  const shapeData = (err as { shape?: { data?: unknown } }).shape?.data;
  if (shapeData && typeof shapeData === 'object') return shapeData as TrpcErrorData;
  return undefined;
}

/**
 * tRPC/mutation hatasını aktif dilde okunabilir bir mesaja çevirir.
 * Toast/inline hata gösteriminde ham `err.message` yerine bunu kullan.
 */
export function mapTrpcError(err: unknown, t: TFunction): string {
  const data = extractData(err);

  if (data?.messageKey) {
    return t(withCommonNs(data.messageKey), {
      ...(data.messageParams ?? {}),
      defaultValue: t('common:errors.unexpected'),
    });
  }

  if (data?.code && CODE_TO_KEY[data.code]) {
    return t(withCommonNs(CODE_TO_KEY[data.code]));
  }

  return t('common:errors.unexpected');
}

// Çağıranın `t`'si farklı bir namespace'e bağlı olabilir (örn.
// useTranslation('billing')). Anahtarlar `common` namespace'inde olduğundan
// namespace yoksa `common:` ön-ekini zorla — böylece her yerden çözülür.
function withCommonNs(key: string): string {
  return key.includes(':') ? key : `common:${key}`;
}
