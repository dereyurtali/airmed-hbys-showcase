// Excel export helper — array<row> → tek sheet'lik .xlsx dosyası, indir.
// #1056 — xlsx (~290KB) yalnız export butonuna basılınca dinamik yüklenir;
// ReportsPage chunk'ına girmez.
export async function exportRowsToExcel(
  filename: string,
  sheetName: string,
  rows: Record<string, unknown>[],
) {
  if (rows.length === 0) return;
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, filename);
}
