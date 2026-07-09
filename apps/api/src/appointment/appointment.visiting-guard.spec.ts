import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { AppointmentService } from './appointment.service';

// #1047 — assertDoctorAvailable misafir-doktor guard'ı: penceresiz misafir
// doktor randevuya KAPALI (400); pencere varsa yalnız pencere içi kabul;
// yerleşik doktor davranışı değişmez.

const DOCTOR_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

type Guard = {
  assertDoctorAvailable(doctorId: string, startsAt: Date, endsAt: Date): Promise<void>;
};

function makeService(args: {
  doctorType: 'local' | 'visiting' | 'referral';
  windows?: { startsAt: Date; endsAt: Date }[];
  leaves?: boolean;
}) {
  const scoped = {
    doctorLeave: {
      findFirst: jest.fn().mockResolvedValue(args.leaves ? { id: 'leave-1' } : null),
    },
    doctorAvailability: { findMany: jest.fn().mockResolvedValue([]) },
    visitingWindow: { findMany: jest.fn().mockResolvedValue(args.windows ?? []) },
    doctor: {
      findFirst: jest.fn().mockResolvedValue({ type: args.doctorType }),
    },
  };
  const prisma = { scoped } as unknown as PrismaService;
  const service = new AppointmentService(
    prisma,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { guard: service as unknown as Guard, scoped };
}

const at = (hh: number) => new Date(2027, 5, 1, hh, 0);

describe('AppointmentService.assertDoctorAvailable — misafir doktor (#1047)', () => {
  it('penceresiz misafir doktor → 400 (varsayılan kapalı)', async () => {
    const { guard } = makeService({ doctorType: 'visiting' });
    await expect(guard.assertDoctorAvailable(DOCTOR_ID, at(10), at(11))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('pencere içi randevu kabul edilir', async () => {
    const { guard } = makeService({
      doctorType: 'visiting',
      windows: [{ startsAt: at(9), endsAt: at(17) }],
    });
    await expect(guard.assertDoctorAvailable(DOCTOR_ID, at(10), at(11))).resolves.toBeUndefined();
  });

  it('pencere dışı randevu reddedilir', async () => {
    const { guard } = makeService({
      doctorType: 'visiting',
      windows: [{ startsAt: at(9), endsAt: at(10) }],
    });
    await expect(guard.assertDoctorAvailable(DOCTOR_ID, at(11), at(12))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('pencere içi ama izinli → izin kazanır (400)', async () => {
    const { guard } = makeService({
      doctorType: 'visiting',
      windows: [{ startsAt: at(9), endsAt: at(17) }],
      leaves: true,
    });
    await expect(guard.assertDoctorAvailable(DOCTOR_ID, at(10), at(11))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('penceresiz YERLEŞİK doktor etkilenmez (kontrol geçer)', async () => {
    const { guard, scoped } = makeService({ doctorType: 'local' });
    await expect(guard.assertDoctorAvailable(DOCTOR_ID, at(10), at(11))).resolves.toBeUndefined();
    // Tip sorgusu yalnız penceresiz durumda yapılır — yerleşikte de 1 sorgu,
    // ama guard fırlatmaz.
    expect(scoped.doctor.findFirst).toHaveBeenCalledTimes(1);
  });
});
