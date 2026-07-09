/**
 * Jest `setupFilesAfterEnv` — test framework kurulduktan sonra koşar (jest global
 * hazır). e2e suite'leri paralel worker'larda koşarken (maxWorkers), in-process
 * HTTP sunucusu ağır yük altında ara sıra bir bağlantıyı düşürüyor: "socket hang
 * up" / "ECONNRESET" / "ETIMEDOUT". Bunlar TEST MANTIĞI hatası DEĞİL — istek hiç
 * tamamlanmıyor; aynı test izolede ve tekrar denemede geçiyor.
 *
 * Bounded retry bu transient'leri yutar (gerçek mantık hatası 1+2 denemede de
 * düşer, maskelenmez). Alternatif (flaky kırmızı CI) daha kötü.
 */
jest.retryTimes(2, { logErrorsBeforeRetry: true });
