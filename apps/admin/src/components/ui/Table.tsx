import type { ReactNode } from 'react';
import { Card } from './Card';
import { cn } from '../../lib/cn';

// #944 (F2) — Platform admin ortak Table primitive. Her liste sayfası elle
// <table> HTML'i + th/td class'larını kopyalıyordu (ImpersonationActivePage,
// FeedbackListPage, …). Tek primitive: kolon tanımı + satır render'ı + boş
// durum. airmed-design token'ları (border, muted, row-hover).

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  /** İsteğe bağlı hücre (td) sınıf eki (ör. whitespace-nowrap, max-w-md). */
  cellClassName?: string;
}

const TH =
  'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground';
const TD = 'px-3 py-2.5 text-sm text-foreground align-top';

export function Table<T>({
  columns,
  rows,
  rowKey,
  rowTestId,
  empty,
  'data-testid': testId,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  rowTestId?: (row: T) => string;
  /** Satır yoksa gösterilecek boş-durum içeriği (verilmezse boş tablo). */
  empty?: ReactNode;
  'data-testid'?: string;
}) {
  if (rows.length === 0 && empty !== undefined) {
    return <Card className="p-8 text-center text-sm text-muted-foreground">{empty}</Card>;
  }
  return (
    <Card className="overflow-x-auto">
      <table className="w-full border-collapse" data-testid={testId}>
        <thead>
          <tr className="border-b border-border bg-muted/40">
            {columns.map((c) => (
              <th key={c.key} className={TH}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              data-testid={rowTestId?.(row)}
              className="border-b border-border last:border-0 hover:bg-[var(--row-hover)]"
            >
              {columns.map((c) => (
                <td key={c.key} className={cn(TD, c.cellClassName)}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
