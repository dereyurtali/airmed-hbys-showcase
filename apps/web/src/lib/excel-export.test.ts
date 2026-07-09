import { describe, expect, it, vi } from 'vitest';
import { exportRowsToExcel } from './excel-export';

vi.mock('xlsx', () => ({
  utils: {
    json_to_sheet: vi.fn((rows: unknown) => ({ rows })),
    book_new: vi.fn(() => ({ SheetNames: [] as string[], Sheets: {} as Record<string, unknown> })),
    book_append_sheet: vi.fn((wb: { SheetNames: string[] }, _ws: unknown, name: string) => {
      wb.SheetNames.push(name);
    }),
  },
  writeFile: vi.fn(),
}));

describe('exportRowsToExcel', () => {
  it('boş row listesinde noop (writeFile çağrılmaz)', async () => {
    const XLSX = await import('xlsx');
    const writeSpy = vi.mocked(XLSX.writeFile);
    writeSpy.mockClear();
    await exportRowsToExcel('empty.xlsx', 'Sheet', []);
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('dolu listede writeFile çağrılır, sheet adı 31 karakterle sınırlı', async () => {
    const XLSX = await import('xlsx');
    const writeSpy = vi.mocked(XLSX.writeFile);
    const appendSpy = vi.mocked(XLSX.utils.book_append_sheet);
    writeSpy.mockClear();
    appendSpy.mockClear();

    const longName = 'A'.repeat(40);
    await exportRowsToExcel('test.xlsx', longName, [{ name: 'Ali' }]);

    expect(writeSpy).toHaveBeenCalledTimes(1);
    const [, , passedName] = appendSpy.mock.calls[0];
    expect(passedName).toHaveLength(31);
  });
});
