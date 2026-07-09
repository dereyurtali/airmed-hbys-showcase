// #937 — CORS izinli origin listesi (REST + WebSocket ortak). WEB_ORIGIN /
// ADMIN_ORIGIN virgülle ayrılmış liste destekler; boşsa dev localhost fallback.
export function getAllowedOrigins(): string[] {
  const split = (raw: string | undefined, fallback: string) =>
    (raw ?? fallback)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  return [
    ...split(process.env.WEB_ORIGIN, 'http://localhost:5173'),
    ...split(process.env.ADMIN_ORIGIN, 'http://localhost:5174'),
  ];
}
