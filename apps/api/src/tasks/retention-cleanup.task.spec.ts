import type { AdminPrismaService } from '../prisma/admin-prisma.service';
import { RetentionCleanupTask } from './retention-cleanup.task';

// #1060 — retention prune davranış kilidi: kapsam (7 operasyonel tablo),
// bounded batch döngüsü, tıbbi-kayıt tablolarına dokunulmadığı.

function makeTask(execImpl?: jest.Mock) {
  const exec = execImpl ?? jest.fn().mockResolvedValue(0);
  const admin = { $executeRawUnsafe: exec } as unknown as AdminPrismaService;
  return { task: new RetentionCleanupTask(admin), exec };
}

describe('RetentionCleanupTask (#1060)', () => {
  it('7 kuralın hepsi çalışır; refresh_tokens ilk sırada', async () => {
    const { task, exec } = makeTask();
    const summary = await task.pruneOnce();
    expect(Object.keys(summary)).toEqual([
      'refresh_tokens',
      'notifications(read)',
      'message_deliveries(terminal)',
      'webhook_deliveries(terminal)',
      'sync_conflicts(resolved)',
      'agent_messages',
      'recall_attempts',
    ]);
    expect(exec).toHaveBeenCalledTimes(7);
  });

  it('batch dolu döndükçe aynı kural tekrarlanır (bounded loop)', async () => {
    // İlk kural (refresh_tokens) 2 tam batch + 1 kısmi; kalanlar boş.
    const exec = jest
      .fn()
      .mockResolvedValueOnce(5000)
      .mockResolvedValueOnce(5000)
      .mockResolvedValueOnce(120)
      .mockResolvedValue(0);
    const { task } = makeTask(exec);
    const summary = await task.pruneOnce();
    expect(summary['refresh_tokens']).toBe(10120);
    // 3 refresh_tokens çağrısı + 6 diğer kural = 9
    expect(exec).toHaveBeenCalledTimes(9);
  });

  it('tıbbi/mali kayıt tablolarına ve patient_thread_messages`e dokunmaz', async () => {
    const { task, exec } = makeTask();
    await task.pruneOnce();
    const allSql = exec.mock.calls.map((c) => String(c[0])).join('\n');
    for (const forbidden of [
      'patient_thread_messages',
      'invoices',
      'examinations',
      'measurements',
      'prescriptions',
      'payments',
      'patients',
    ]) {
      expect(allSql).not.toContain(`FROM ${forbidden}`);
    }
  });

  it('silme koşulları aktif satırları korur (terminal/expired filtreleri)', async () => {
    const { task, exec } = makeTask();
    await task.pruneOnce();
    const sqlByName = exec.mock.calls.map((c) => String(c[0]));
    expect(sqlByName[0]).toContain('expires_at < $1 OR revoked_at < $1');
    expect(sqlByName.find((s) => s.includes('FROM notifications'))).toContain(
      'read_at IS NOT NULL',
    );
    // PENDING (bekleyen) satırlar silinmez — yalnız terminal durumlar.
    expect(sqlByName.find((s) => s.includes('FROM message_deliveries'))).toContain(
      "status IN ('SENT', 'DELIVERED', 'FAILED')",
    );
  });
});
