// #907 — İndirim onayı ekranlarında (AdminOverviewPage + ApprovalsPage) birebir
// kopyalanan biçimlendirme yardımcıları tek yerde.

/** İsim → avatar baş harfleri. "Dr./Prof./Op." unvan öneki atılır. */
export function initials(name: string): string {
  const parts = name
    .replace(/^(Dr|Dr\.|Prof|Prof\.|Op|Op\.)\s+/i, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '–';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** İndirim yüzdesi → tamsa tam, değilse 1 ondalık ("12" / "12.5"). */
export function formatPercent(percent: string): string {
  const n = parseFloat(percent);
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
