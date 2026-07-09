// S15 — Standalone seed for new S15 models (IolModel + Lot + Kit + LabThreshold).
// `seed-realistic.ts` patient/exam akışı ön gerektirir; S15 seed'leri tenant'a
// bağımsız bağlıdır, hızlı demo için bunlar ayrı çağrılır.
//
// Çalıştır: DATABASE_URL=... npm run db:seed:s15

import { PrismaClient, type EncounterStage } from '@prisma/client';
import { createHash } from 'node:crypto';
import { assertSeedAllowed } from './_seed-guard';

const prisma = new PrismaClient();

const TENANT_SLUG = 'demoeye-dushanbe';

function did(seed: string): string {
  const h = createHash('sha256').update(seed).digest('hex');
  return `${h.substring(0, 8)}-${h.substring(8, 12)}-4${h.substring(13, 16)}-${(
    (parseInt(h[16], 16) & 0x3) |
    0x8
  ).toString(16)}${h.substring(17, 20)}-${h.substring(20, 32)}`;
}

async function seedIolStockAndKits(tenantId: string) {
  // S16 — lensType (Lens İhtiyacı gruplaması) + minQty (yeniden-sipariş eşiği) +
  // lot bazında deterministik stok {available, reserved}. Stok & Malzeme mockup'ı:
  //   - monofocal: 22 mevcut + 4 rezerve = 26 toplam, min 8 → Yeterli
  //   - trifocal :  2 mevcut + 5 rezerve =  7 toplam, min 8 → Düşük
  //   - edof     :  9 mevcut + 2 rezerve = 11 toplam, min 4 → Yeterli
  //   - toric    : 14 mevcut + 0 rezerve = 14 toplam, min 0 → Yeterli
  const models = [
    {
      key: 'monofocal',
      brand: 'Alcon',
      model: 'SN60WF Monofocal',
      desc: 'Standart monofocal hidrofobik akrilik',
      lensType: 'monofocal',
      minQty: 8,
      lots: [
        { a: 14, r: 2 },
        { a: 8, r: 2 },
      ],
    },
    {
      key: 'trifocal',
      brand: 'Alcon',
      model: 'PanOptix Trifocal',
      desc: 'Premium trifocal (yakın + orta + uzak)',
      lensType: 'trifocal',
      minQty: 8,
      lots: [
        { a: 1, r: 3 },
        { a: 1, r: 2 },
      ],
    },
    {
      key: 'edof',
      brand: 'Johnson & Johnson',
      model: 'Tecnis Symfony EDOF',
      desc: 'EDOF — genişletilmiş odak derinliği',
      lensType: 'edof',
      minQty: 4,
      lots: [
        { a: 5, r: 1 },
        { a: 4, r: 1 },
      ],
    },
    {
      key: 'toric',
      brand: 'Johnson & Johnson',
      model: 'Tecnis Toric',
      desc: 'Astigmat düzeltme + monofocal',
      lensType: 'toric',
      minQty: 0,
      lots: [
        { a: 8, r: 0 },
        { a: 6, r: 0 },
      ],
    },
  ];
  // Business unique key (tenantId, brand, model) ile upsert — seed-realistic
  // önce çalışırsa mevcut id korunur; yoksa deterministik did() id'si ile create.
  const created: { key: string; id: string }[] = [];
  for (const m of models) {
    const fallbackId = did(`iol-model:${tenantId}:${m.key}`);
    const row = await prisma.iolModel.upsert({
      where: {
        tenantId_brand_model: { tenantId, brand: m.brand, model: m.model },
      },
      update: { isActive: true, description: m.desc, lensType: m.lensType, minQty: m.minQty },
      create: {
        id: fallbackId,
        tenantId,
        brand: m.brand,
        model: m.model,
        description: m.desc,
        lensType: m.lensType,
        minQty: m.minQty,
        isActive: true,
      },
      select: { id: true },
    });
    created.push({ key: m.key, id: row.id });
  }

  const lots: { key: string; modelKey: string; id: string }[] = [];
  for (let mi = 0; mi < created.length; mi++) {
    const m = created[mi]!;
    const lotSpecs = models[mi]!.lots;
    for (let i = 0; i < lotSpecs.length; i++) {
      const power = 20 + i * 1.5;
      const lotKey = `${m.key}-lot${i + 1}`;
      const fallbackId = did(`iol-lot:${tenantId}:${lotKey}`);
      const lotNumber = `LOT-${m.key.toUpperCase()}-2026-${i + 1}`;
      const avail = lotSpecs[i]!.a;
      const reserved = lotSpecs[i]!.r;
      const total = avail + reserved;
      const expiresAt = new Date();
      expiresAt.setFullYear(expiresAt.getFullYear() + 2);
      const row = await prisma.iolLot.upsert({
        where: {
          tenantId_modelId_lotNumber_power: {
            tenantId,
            modelId: m.id,
            lotNumber,
            power,
          },
        },
        // Demo determinizmi: stok her seed'de senaryo değerine sıfırlanır.
        update: { quantity: total, availableQty: avail, reservedQty: reserved, consumedQty: 0 },
        create: {
          id: fallbackId,
          tenantId,
          modelId: m.id,
          lotNumber,
          power,
          quantity: total,
          availableQty: avail,
          reservedQty: reserved,
          consumedQty: 0,
          version: 0,
          expiresAt,
          supplier: 'DemoEye Supplier Ltd.',
        },
        select: { id: true },
      });
      lots.push({ key: lotKey, modelKey: m.key, id: row.id });
    }
  }

  const kits = [
    {
      key: 'phaco-standard',
      code: 'PHACO-STD',
      name: 'Phaco Standart Paket (Monofocal)',
      surgeryType: 'Phacoemulsification + IOL',
      components: [
        { modelKey: 'monofocal', qty: 1, required: true, name: null as string | null },
        { modelKey: null, qty: 1, required: true, name: 'Phaco kartuş seti' as string | null },
        {
          modelKey: null,
          qty: 1,
          required: true,
          name: 'Viscoelastic (Healon 1ml)' as string | null,
        },
        {
          modelKey: null,
          qty: 1,
          required: false,
          name: 'Steril drape + örtüler' as string | null,
        },
      ],
    },
    {
      key: 'phaco-trifocal',
      code: 'PHACO-TRI',
      name: 'Phaco Trifocal Paket (Premium)',
      surgeryType: 'Phacoemulsification + Trifocal IOL',
      components: [
        { modelKey: 'trifocal', qty: 1, required: true, name: null as string | null },
        { modelKey: null, qty: 1, required: true, name: 'Phaco kartuş seti' as string | null },
        {
          modelKey: null,
          qty: 2,
          required: true,
          name: 'Premium viscoelastic (Healon GV)' as string | null,
        },
        { modelKey: null, qty: 1, required: true, name: 'Capsular tension ring' as string | null },
      ],
    },
    {
      key: 'phaco-toric',
      code: 'PHACO-TOR',
      name: 'Phaco Toric Paket (Astigmat)',
      surgeryType: 'Phacoemulsification + Toric IOL',
      components: [
        { modelKey: 'toric', qty: 1, required: true, name: null as string | null },
        { modelKey: null, qty: 1, required: true, name: 'Phaco kartuş seti' as string | null },
        { modelKey: null, qty: 1, required: true, name: 'Toric marker (pre-op)' as string | null },
        {
          modelKey: null,
          qty: 1,
          required: false,
          name: 'Viscoelastic (Healon 1ml)' as string | null,
        },
      ],
    },
  ];

  for (const k of kits) {
    const fallbackKitId = did(`surgical-kit:${tenantId}:${k.key}`);
    const kitRow = await prisma.surgicalKit.upsert({
      where: { tenantId_code: { tenantId, code: k.code } },
      update: { isActive: true, name: k.name },
      create: {
        id: fallbackKitId,
        tenantId,
        code: k.code,
        name: k.name,
        surgeryType: k.surgeryType,
        isActive: true,
      },
      select: { id: true },
    });
    const kitId = kitRow.id;
    await prisma.surgicalKitComponent.deleteMany({ where: { kitId } });
    for (let i = 0; i < k.components.length; i++) {
      const c = k.components[i];
      const cid = did(`surgical-kit-comp:${kitId}:${i}`);
      const iolModelId = c.modelKey
        ? (created.find((m) => m.key === c.modelKey)?.id ?? null)
        : null;
      await prisma.surgicalKitComponent.create({
        data: {
          id: cid,
          tenantId,
          kitId,
          iolModelId,
          componentName: c.name,
          quantity: c.qty,
          isRequired: c.required,
        },
      });
    }
  }

  return { models: created, lots, kits };
}

async function seedLabThresholds(tenantId: string) {
  const thresholds = [
    {
      key: 'hba1c-adult',
      testCode: 'HBA1C',
      sex: 'any' as const,
      ageMin: 18,
      ageMax: 120,
      lowLimit: '4.0',
      highLimit: '6.5',
      unit: '%',
      notes: 'Diyabet eşiği — >6.5 oftalmoloji cerrahisi risk',
    },
    {
      key: 'crp-adult',
      testCode: 'CRP',
      sex: 'any' as const,
      ageMin: 18,
      ageMax: 120,
      lowLimit: null,
      highLimit: '5.0',
      unit: 'mg/L',
      notes: 'Pre-op enflamasyon belirteci — >5 araştır',
    },
    {
      key: 'axial-length-adult',
      testCode: 'AXIAL_LENGTH',
      sex: 'any' as const,
      ageMin: 18,
      ageMax: 120,
      lowLimit: '20.0',
      highLimit: '26.0',
      unit: 'mm',
      notes: 'IOL hesabı için kritik — <20 veya >26 nadir, dikkat',
    },
    {
      key: 'iop-adult',
      testCode: 'IOP',
      sex: 'any' as const,
      ageMin: 18,
      ageMax: 120,
      lowLimit: '10.0',
      highLimit: '21.0',
      unit: 'mmHg',
      notes: 'Göz içi basıncı — >21 glokom araştır',
    },
    {
      key: 'retina-thickness',
      testCode: 'RETINA_THICKNESS_OCT',
      sex: 'any' as const,
      ageMin: 18,
      ageMax: 120,
      lowLimit: '200.0',
      highLimit: '300.0',
      unit: 'μm',
      notes: 'OCT makula kalınlığı — >300 ödem şüphesi',
    },
    {
      key: 'glucose-fasting',
      testCode: 'GLUCOSE_FASTING',
      sex: 'any' as const,
      ageMin: 18,
      ageMax: 120,
      lowLimit: '70.0',
      highLimit: '110.0',
      unit: 'mg/dL',
      notes: 'Açlık glikozu — pre-op standart',
    },
  ];

  for (const t of thresholds) {
    const fallbackId = did(`lab-threshold:${tenantId}:${t.key}`);
    await prisma.labAbnormalThreshold.upsert({
      where: {
        tenantId_testCode_sex_ageMin_ageMax: {
          tenantId,
          testCode: t.testCode,
          sex: t.sex,
          ageMin: t.ageMin,
          ageMax: t.ageMax,
        },
      },
      update: { isActive: true },
      create: {
        id: fallbackId,
        tenantId,
        testCode: t.testCode,
        sex: t.sex,
        ageMin: t.ageMin,
        ageMax: t.ageMax,
        lowLimit: t.lowLimit,
        highLimit: t.highLimit,
        unit: t.unit,
        notes: t.notes,
        isActive: true,
      },
    });
  }

  return thresholds.length;
}

// S16 — Sarf malzeme + ilaç stoğu (IOL-dışı). Stok & Malzeme Takibi sayfası:
// 'supply' (Sarf Malzeme) + 'drug' (İlaç) grupları. Kritik Stok: Keratom
// düşük (13 < min 15), diğerleri sağlıklı → tek kritik sarf kalem.
// Idempotent: eski-isimli demo satırları sıfırlanır (deleteMany), sonra kurulur.
async function seedConsumables(tenantId: string) {
  await prisma.consumable.deleteMany({ where: { tenantId } });
  const items = [
    // Sarf Malzeme (supply): toplam = available + reserved.
    {
      name: 'Viskoelastik',
      code: 'VSC',
      category: 'supply',
      unit: 'adet',
      available: 29,
      reserved: 9,
      minQty: 12,
    },
    {
      name: 'BSS Solüsyon',
      code: 'BSS',
      category: 'supply',
      unit: 'şişe',
      available: 43,
      reserved: 9,
      minQty: 15,
    },
    {
      name: 'Keratom Bıçağı',
      code: 'BLADE',
      category: 'supply',
      unit: 'adet',
      available: 13,
      reserved: 6,
      minQty: 15,
    },
    // İlaç (drug).
    {
      name: 'Anti-VEGF Flakon',
      code: 'ANTIVEGF',
      category: 'drug',
      unit: 'flakon',
      available: 7,
      reserved: 2,
      minQty: 3,
    },
    {
      name: 'Mitomisin-C',
      code: 'MMC',
      category: 'drug',
      unit: 'flakon',
      available: 4,
      reserved: 1,
      minQty: 2,
    },
  ];
  for (const c of items) {
    const fallbackId = did(`consumable:${tenantId}:${c.code}`);
    await prisma.consumable.upsert({
      where: { tenantId_name: { tenantId, name: c.name } },
      update: {
        code: c.code,
        category: c.category,
        unit: c.unit,
        availableQty: c.available,
        reservedQty: c.reserved,
        minQty: c.minQty,
        isActive: true,
      },
      create: {
        id: fallbackId,
        tenantId,
        name: c.name,
        code: c.code,
        category: c.category,
        unit: c.unit,
        availableQty: c.available,
        reservedQty: c.reserved,
        minQty: c.minQty,
        isActive: true,
      },
    });
  }
  return items.length;
}

/**
 * Doktor menüsü demo verisi: doktor.demo'ya atanmış hastalar (Hastalarım) +
 * aktif iş kuyruğu (Muayene Sırası badge) + ölçüm sipariş kuyruğu + bildirim
 * zili. seed-realistic'ten SONRA çalışmalı (30 gerçekçi hastayı kullanır).
 * Idempotent: doktorun mevcut demo encounter/order/bildirimlerini sıfırlar.
 */
async function seedDoctorWorklistDemo(
  tenantId: string,
  stock: { lots: { key: string; modelKey: string; id: string }[] },
) {
  const demoUser = await prisma.user.findFirst({
    where: { tenantId, email: 'doktor.demo@demoeye.tj', deletedAt: null },
    select: { id: true },
  });
  if (!demoUser) {
    console.warn('[seed-s15] doktor.demo yok — worklist demo atlandı');
    return { assigned: 0, encounters: 0 };
  }
  const doctor = await prisma.doctor.findFirst({
    where: { tenantId, userId: demoUser.id, deletedAt: null },
    select: { id: true },
  });
  if (!doctor) {
    console.warn('[seed-s15] doktor.demo Doctor profili yok — worklist demo atlandı');
    return { assigned: 0, encounters: 0 };
  }

  // Gerçekçi hastalar (seed-realistic, MRN 'TD…') — baseline test hastasını atla
  // (realistic-test-data standardı: "test" isimli hasta vitrin olmasın).
  const patients = await prisma.patient.findMany({
    where: { tenantId, deletedAt: null, mrn: { startsWith: 'TD' } },
    select: { id: true },
    orderBy: { mrn: 'asc' },
    take: 8,
  });
  if (patients.length === 0) {
    console.warn('[seed-s15] hasta yok (önce seed:realistic) — worklist demo atlandı');
    return { assigned: 0, encounters: 0 };
  }

  // Hastalarım: PatientDoctor atamaları (doktor scope'u bu zincirden gelir).
  // Idempotent: önce bu doktorun mevcut atamalarını temizle, sonra demo
  // hastalarını ata — tekrar seed'lerde birikme olmasın (net liste).
  await prisma.patientDoctor.deleteMany({ where: { tenantId, doctorId: doctor.id } });
  let assigned = 0;
  for (let i = 0; i < patients.length; i++) {
    const p = patients[i]!;
    await prisma.patientDoctor.create({
      data: {
        tenantId,
        patientId: p.id,
        doctorId: doctor.id,
        isPrimary: i === 0,
        source: 'manual',
      },
    });
    assigned++;
  }

  // Idempotent reset (bu doktora ait demo kayıtlar).
  await prisma.measurement.updateMany({
    where: {
      tenantId,
      measurementOrder: { doctorId: doctor.id },
      measurementOrderId: { not: null },
    },
    data: { measurementOrderId: null },
  });
  await prisma.measurementOrder.deleteMany({ where: { tenantId, doctorId: doctor.id } });
  await prisma.notification.deleteMany({ where: { tenantId, recipientUserId: demoUser.id } });
  await prisma.encounter.deleteMany({ where: { tenantId, doctorId: doctor.id } });
  // Encounter FK'si appointment'a bağlı → encounter'lardan SONRA sil.
  await prisma.appointment.deleteMany({ where: { tenantId, doctorId: doctor.id } });
  // Demo ölçümleri (marker 'demo-s15') — realistic ölçümlere dokunma.
  await prisma.measurement.deleteMany({ where: { tenantId, notes: 'demo-s15' } });

  const now = Date.now();
  const todayAt = (h: number, m: number) => {
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d;
  };

  // Muayene Sırası: mockup'a uygun kuyruk — Ölçüm hazır (seçili, tam veri) +
  // Sırada (waiting_doctor) + Ölçümde (in_measurement) + Ödenmemiş
  // (awaiting_measurement_payment). Randevu notu = ziyaret sebebi (kart alt satırı).
  const QUEUE: { stage: EncounterStage; reason: string; h: number; m: number }[] = [
    { stage: 'measurement_ready', reason: 'Katarakt danışma', h: 8, m: 52 },
    { stage: 'waiting_doctor', reason: 'Görme bulanıklığı', h: 9, m: 5 },
    { stage: 'waiting_doctor', reason: 'Göz kuruluğu', h: 9, m: 20 },
    { stage: 'in_measurement', reason: 'Katarakt kontrol', h: 9, m: 35 },
    { stage: 'awaiting_measurement_payment', reason: 'Göz tansiyonu kontrolü', h: 9, m: 50 },
  ];
  let encounters = 0;
  const apptBase = todayAt(9, 0).getTime();
  for (let i = 0; i < QUEUE.length && i < patients.length; i++) {
    const q = QUEUE[i]!;
    // Randevu slotları çakışamaz (appointments_no_overlap exclusion constraint)
    // → 30dk aralıklı; geliş saati (openedAt) ayrı, mockup'a uygun.
    const apptStart = new Date(apptBase + i * 30 * 60_000);
    const appt = await prisma.appointment.create({
      data: {
        tenantId,
        patientId: patients[i]!.id,
        doctorId: doctor.id,
        type: 'consultation',
        startsAt: apptStart,
        endsAt: new Date(apptStart.getTime() + 25 * 60_000),
        notes: q.reason,
      },
      select: { id: true },
    });
    await prisma.encounter.create({
      data: {
        tenantId,
        patientId: patients[i]!.id,
        doctorId: doctor.id,
        appointmentId: appt.id,
        stage: q.stage,
        openedAt: todayAt(q.h, q.m),
        stageUpdatedAt: new Date(now - i * 7 * 60_000),
      },
    });
    encounters++;
  }

  // Seçili hasta (Ölçüm hazır): kaynak + öykü + OD/OS ölçümler → detay paneli dolsun.
  const selected = patients[0]!;
  await prisma.patient.update({
    where: { id: selected.id },
    data: { leadSourceNote: 'Sosyal medya' },
  });
  // Demo muayeneleri (güncel + geçmiş) idempotent: bu doktor+hastanın demo
  // muayenelerini temizle, sonra güncel + 2 geçmiş muayene oluştur. Güncel olan
  // Öykü kartında; geçmişler detay altındaki "Geçmiş Muayeneler" listesinde.
  const monthsAgoAt = (n: number) => {
    const d = new Date();
    d.setMonth(d.getMonth() - n);
    d.setHours(10, 0, 0, 0);
    return d;
  };
  await prisma.examination.deleteMany({
    where: { tenantId, patientId: selected.id, doctorId: demoUser.id },
  });
  await prisma.examination.createMany({
    data: [
      {
        tenantId,
        patientId: selected.id,
        doctorId: demoUser.id,
        examinedAt: todayAt(9, 0),
        chiefComplaint: 'Yakın görmede zorlanma ve gece araba kullanırken kamaşma şikâyeti.',
        history: '2 yıldır gözlük kullanıyor. Bilinen sistemik hastalık yok (DM/HT yok).',
        diagnosis: 'Katarakt şüphesi',
      },
      {
        tenantId,
        patientId: selected.id,
        doctorId: demoUser.id,
        examinedAt: monthsAgoAt(5),
        chiefComplaint: 'Rutin göz kontrolü, hafif bulanıklık.',
        diagnosis: 'Başlangıç katarakt (her iki göz)',
      },
      {
        tenantId,
        patientId: selected.id,
        doctorId: demoUser.id,
        examinedAt: monthsAgoAt(11),
        chiefComplaint: 'Gözlük reçetesi yenileme.',
        diagnosis: 'Presbiyopi + hafif miyopi',
      },
    ],
  });

  // S16 — Yönetici "Bugün muayene" KPI = 5. Seçili hasta bugün 1 muayene aldı;
  // 4 hasta daha bugün muayene → toplam 5. Idempotent: bugünün ek muayeneleri
  // (demoUser, examinedAt >= bugün 00:00) re-seed'de temizlenir.
  const extraExamPatients = [patients[1], patients[2], patients[3], patients[4]].filter(
    (p): p is { id: string } => Boolean(p),
  );
  if (extraExamPatients.length > 0) {
    await prisma.examination.deleteMany({
      where: {
        tenantId,
        doctorId: demoUser.id,
        examinedAt: { gte: todayAt(0, 0) },
        patientId: { in: extraExamPatients.map((p) => p.id) },
      },
    });
    const examMeta = [
      {
        complaint: 'Uzak görmede bulanıklık, gözlükle netlik azaldı.',
        diagnosis: 'Refraktif kusur / erken katarakt',
      },
      { complaint: 'Göz kuruluğu ve batma hissi, akşam artıyor.', diagnosis: 'Kuru göz sendromu' },
      {
        complaint: 'Katarakt kontrolü — ameliyat öncesi değerlendirme.',
        diagnosis: 'Olgun katarakt (sağ göz)',
      },
      {
        complaint: 'Göz içi basıncı kontrolü, aile öyküsü mevcut.',
        diagnosis: 'Oküler hipertansiyon takibi',
      },
    ];
    await prisma.examination.createMany({
      data: extraExamPatients.map((p, i) => ({
        tenantId,
        patientId: p.id,
        doctorId: demoUser.id,
        examinedAt: todayAt(9 + i, 15),
        chiefComplaint: examMeta[i]!.complaint,
        diagnosis: examMeta[i]!.diagnosis,
      })),
    });
  }

  // 5 ay önceki muayene gününe ait işlemler: katarakt ameliyatı + ölçümler
  // (geçmiş muayene satırı açılınca "İşlemler" altında aynı-gün eşlemesiyle görünür).
  await prisma.surgery.deleteMany({
    where: { tenantId, patientId: selected.id, doctorId: doctor.id },
  });
  await prisma.surgery.create({
    data: {
      tenantId,
      patientId: selected.id,
      doctorId: doctor.id,
      type: 'Fakoemülsifikasyon + IOL (Katarakt)',
      status: 'performed',
      scheduledAt: monthsAgoAt(5),
      performedAt: monthsAgoAt(5),
      eyeSide: 'od',
    },
  });
  await prisma.measurement.createMany({
    data: [
      {
        tenantId,
        patientId: selected.id,
        type: 'visual_acuity',
        eyeSide: 'od',
        values: { decimal: 0.6 },
        measuredAt: monthsAgoAt(5),
        measuredById: demoUser.id,
        notes: 'demo-s15',
      },
      {
        tenantId,
        patientId: selected.id,
        type: 'intraocular_pressure',
        eyeSide: 'od',
        values: { mmHg: 17 },
        measuredAt: monthsAgoAt(5),
        measuredById: demoUser.id,
        notes: 'demo-s15',
      },
    ],
  });

  const measuredAt = todayAt(14, 2);
  const measRows: {
    type: 'visual_acuity' | 'intraocular_pressure' | 'refraction' | 'biometry';
    od: Record<string, string | number>;
    os: Record<string, string | number>;
  }[] = [
    { type: 'visual_acuity', od: { decimal: 0.4 }, os: { decimal: 0.5 } },
    { type: 'intraocular_pressure', od: { mmHg: 16 }, os: { mmHg: 15 } },
    {
      type: 'refraction',
      od: { sphere: '+1.25', cylinder: '-0.75', axis: 90 },
      os: { sphere: '+1.00', cylinder: '-0.50', axis: 85 },
    },
    { type: 'biometry', od: { axialLength: '23.8' }, os: { axialLength: '23.6' } },
  ];
  for (const mr of measRows) {
    await prisma.measurement.createMany({
      data: [
        {
          tenantId,
          patientId: selected.id,
          type: mr.type,
          eyeSide: 'od',
          values: mr.od,
          measuredAt,
          measuredById: demoUser.id,
          notes: 'demo-s15',
        },
        {
          tenantId,
          patientId: selected.id,
          type: mr.type,
          eyeSide: 'os',
          values: mr.os,
          measuredAt,
          measuredById: demoUser.id,
          notes: 'demo-s15',
        },
      ],
    });
  }

  // Ölçüm birimi kuyruğu (ölçüm hemşiresi "Ölçüm Talepleri" ekranı). Sebep
  // (notes) detay başlığında "Katarakt kontrolü" gibi görünür.
  // 1) Katarakt kontrol — VA + biyometri + GİB (mockup senaryosu, fulfillable).
  if (patients[1]) {
    await prisma.measurementOrder.create({
      data: {
        tenantId,
        patientId: patients[1].id,
        orderedById: demoUser.id,
        doctorId: doctor.id,
        requestedTypes: ['visual_acuity', 'biometry', 'intraocular_pressure'],
        serviceItemIds: [],
        requiresPayment: false,
        status: 'requested',
        notes: 'Katarakt kontrolü',
      },
    });
  }
  // 2) Pre-op biyometri/keratometri (ücretsiz, fulfillable).
  if (patients[2]) {
    await prisma.measurementOrder.create({
      data: {
        tenantId,
        patientId: patients[2].id,
        orderedById: demoUser.id,
        doctorId: doctor.id,
        requestedTypes: ['biometry', 'keratometry'],
        serviceItemIds: [],
        requiresPayment: false,
        status: 'requested',
        notes: 'Ameliyat öncesi IOL ölçümü',
      },
    });
  }
  // 3) Topografi — ücretli (ödeme bekliyor).
  if (patients[4]) {
    await prisma.measurementOrder.create({
      data: {
        tenantId,
        patientId: patients[4].id,
        orderedById: demoUser.id,
        doctorId: doctor.id,
        requestedTypes: ['topography'],
        serviceItemIds: [],
        requiresPayment: true,
        status: 'awaiting_payment',
        notes: 'Refraktif değerlendirme',
      },
    });
  }
  // 4) Bugün TAMAMLANMIŞ (doktora gönderilmiş) ölçüm — "Tamamlanan" sekmesi vitrini
  // (VA/AR/GİB/BİO; 13:48 istendi → 14:02 tamamlandı). measurementlar 'demo-s15'
  // işaretli → idempotent reset temizler.
  if (patients[3]) {
    const completedOrder = await prisma.measurementOrder.create({
      data: {
        tenantId,
        patientId: patients[3].id,
        orderedById: demoUser.id,
        doctorId: doctor.id,
        requestedTypes: ['visual_acuity', 'refraction', 'intraocular_pressure', 'biometry'],
        serviceItemIds: [],
        requiresPayment: false,
        status: 'fulfilled',
        notes: 'Katarakt ameliyatı öncesi tam ölçüm',
        fulfilledById: demoUser.id,
        fulfilledAt: todayAt(14, 2),
        createdAt: todayAt(13, 48),
      },
    });
    await prisma.measurement.createMany({
      data: [
        { type: 'visual_acuity', eyeSide: 'od', values: { decimal: 0.7 } },
        { type: 'visual_acuity', eyeSide: 'os', values: { decimal: 0.8 } },
        { type: 'intraocular_pressure', eyeSide: 'od', values: { mmHg: 18 } },
        { type: 'intraocular_pressure', eyeSide: 'os', values: { mmHg: 19 } },
        { type: 'biometry', eyeSide: 'od', values: { axialLength: '23.5' } },
        { type: 'biometry', eyeSide: 'os', values: { axialLength: '23.7' } },
      ].map((m) => ({
        tenantId,
        patientId: patients[3]!.id,
        type: m.type as 'visual_acuity' | 'intraocular_pressure' | 'biometry',
        eyeSide: m.eyeSide as 'od' | 'os',
        values: m.values,
        measuredAt: todayAt(14, 2),
        measuredById: demoUser.id,
        measurementOrderId: completedOrder.id,
        notes: 'demo-s15',
      })),
    });
  }

  // Bildirim zili: 2 okunmamış.
  await prisma.notification.createMany({
    data: [
      {
        tenantId,
        recipientUserId: demoUser.id,
        type: 'measurement_ready',
        title: 'Ölçüm sonuçları hazır',
        body: 'İstediğiniz ölçümlerin sonuçları girildi.',
        payload: patients[2] ? { patientId: patients[2].id } : {},
      },
      {
        tenantId,
        recipientUserId: demoUser.id,
        type: 'sent_to_doctor',
        title: 'Yeni hasta kuyruğunuzda',
        body: 'Ödeme alındı, hasta size yönlendirildi.',
        payload: patients[0] ? { patientId: patients[0].id } : {},
      },
    ],
  });

  // S16 — Ameliyat satış vitrini: cerrahi paket kataloğu artık frontend spec'inde
  // (apps/web/src/lib/surgery-catalog.ts; lens/malzeme/fiyat yapısal). DB
  // ServiceItem'a gerek yok — burada yalnız yaklaşan planlı ameliyat pipeline'ı.

  // Yaklaşan planlı ameliyatlar — Satış Hattı pipeline (4 durum) + Ameliyat
  // Takvimi. Idempotent reset: demo cerrahilerine bağlı fatura→onay/kalem/ödeme
  // zincirini (FK sırası) sonra cerrahileri sil. "Fiyatı Ver" kullanıldıysa
  // biriken gerçek faturalar da temizlenir (re-seed FK hatası vermez).
  // 1) Demo cerrahi faturaları: '2026-9xxx' kalıbı (seed) VEYA geleceğe-planlı
  // demo cerrahiye bağlı (Fiyatı Ver ile oluşmuş, auto-number). Çocuklarıyla sil.
  const demoInvs = await prisma.invoice.findMany({
    where: {
      tenantId,
      OR: [
        { invoiceNumber: { startsWith: '2026-9' } },
        {
          surgery: { doctorId: doctor.id, status: 'planned', scheduledAt: { gt: new Date() } },
        },
      ],
    },
    select: { id: true },
  });
  const demoInvIds = demoInvs.map((i) => i.id);
  if (demoInvIds.length > 0) {
    await prisma.discountApproval.deleteMany({ where: { invoiceId: { in: demoInvIds } } });
    await prisma.payment.deleteMany({ where: { invoiceId: { in: demoInvIds } } });
    await prisma.invoiceItem.deleteMany({ where: { invoiceId: { in: demoInvIds } } });
    await prisma.invoice.deleteMany({ where: { id: { in: demoInvIds } } });
  }
  // 2) Faturalar gittikten sonra geleceğe-planlı demo cerrahileri sil. Önce
  // bu cerrahilere bağlı PreOp (lens rezervasyonu) satırlarını temizle — PreOp
  // FK'si surgery'ye bağlı, aksi halde delete FK ihlali verir.
  const plannedFuture = await prisma.surgery.findMany({
    where: { tenantId, doctorId: doctor.id, status: 'planned', scheduledAt: { gt: new Date() } },
    select: { id: true },
  });
  if (plannedFuture.length > 0) {
    await prisma.preOp.deleteMany({
      where: { surgeryId: { in: plannedFuture.map((s) => s.id) } },
    });
  }
  await prisma.surgery.deleteMany({
    where: { tenantId, doctorId: doctor.id, status: 'planned', scheduledAt: { gt: new Date() } },
  });
  const inDaysAt = (days: number, h: number, m: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(h, m, 0, 0);
    return d;
  };
  // Her satır bir pipeline durumu: invoice yok=Yeni · open=Fiyat verildi ·
  // pending_approval=Yönetici onayında · paid=Planlandı. preOp.notes = doktor
  // önerisi (Satış Hattı detayında gösterilir).
  // Lens lot eşlemesi (yönetici "Lens İhtiyacı" paneli): fiyatı verilmiş/onaya
  // gitmiş ameliyatlara PreOp lens rezervasyonu bağlanır → tipe göre talep
  // (monofocal/trifocal/edof her biri 1). Yeni (fiyatsız) ameliyatta lens henüz
  // rezerve edilmez. satis.demo = indirim onayını talep eden satışçı.
  const lotByKey = new Map(stock.lots.map((l) => [l.key, l.id]));
  const salesUser = await prisma.user.findFirst({
    where: { tenantId, email: 'satis.demo@demoeye.tj', deletedAt: null },
    select: { id: true },
  });
  const pipelineDemo: {
    p: { id: string } | undefined;
    type: string;
    eyeSide: 'od' | 'os' | 'ou';
    at: Date;
    note: string;
    invoice: { status: 'open' | 'pending_approval' | 'paid'; total: string } | null;
    lensLotKey: string | null;
  }[] = [
    {
      p: patients[5],
      type: 'Katarakt (Fako + Trifocal IOL)',
      eyeSide: 'od',
      at: inDaysAt(2, 11, 20),
      note: 'Sağ göz ileri nükleer katarakt. Hasta yakın+uzak gözlüksüz görmek istiyor → trifokal uygun.',
      invoice: null,
      lensLotKey: null,
    },
    {
      p: patients[6],
      type: 'Katarakt (Fako + Monofocal IOL)',
      eyeSide: 'os',
      at: inDaysAt(4, 9, 30),
      note: 'Sol göz olgun katarakt; standart monofokal yeterli.',
      invoice: { status: 'open', total: '18000' },
      lensLotKey: 'monofocal-lot1',
    },
    {
      p: patients[7],
      type: 'Katarakt (Fako + Trifocal IOL)',
      eyeSide: 'ou',
      at: inDaysAt(9, 10, 0),
      note: 'Bilateral katarakt; premium trifokal talep edildi, indirimli paket onaya gönderildi.',
      invoice: { status: 'pending_approval', total: '32760' },
      lensLotKey: 'trifocal-lot1',
    },
    {
      p: patients[1],
      type: 'Katarakt (Fako + EDOF IOL)',
      eyeSide: 'od',
      at: inDaysAt(6, 13, 0),
      note: 'Sağ göz katarakt; hasta gözlüksüz uzak+orta mesafe istiyor → EDOF önerildi (lens planlandı, fiyat aşaması).',
      invoice: null,
      lensLotKey: 'edof-lot1',
    },
    {
      p: patients[0],
      type: 'Pterjium Eksizyonu',
      eyeSide: 'ou',
      at: inDaysAt(16, 14, 0),
      note: 'Bilateral pterjium, görme aksını tehdit ediyor.',
      invoice: { status: 'paid', total: '12000' },
      lensLotKey: null,
    },
  ];
  let opInvoiceSeq = 9001;
  for (const u of pipelineDemo) {
    if (!u.p) continue;
    const created = await prisma.surgery.create({
      data: {
        tenantId,
        patientId: u.p.id,
        doctorId: doctor.id,
        type: u.type,
        status: 'planned',
        scheduledAt: u.at,
        eyeSide: u.eyeSide,
        preOp: { laterality: u.eyeSide.toUpperCase(), notes: u.note },
      },
    });
    // Lens rezervasyonu (PreOp tablosu — surgery.preOp JSON'undan ayrı): forecast
    // servisi planlı ameliyatların PreOp.lensIolLotId'sini ihtiyaç olarak toplar.
    const lotId = u.lensLotKey ? lotByKey.get(u.lensLotKey) : undefined;
    if (lotId) {
      await prisma.preOp.create({
        data: {
          tenantId,
          surgeryId: created.id,
          lensIolLotId: lotId,
          anesthesiaNotes: 'Topikal anestezi planlandı.',
        },
      });
    }
    if (u.invoice) {
      const inv = await prisma.invoice.create({
        data: {
          tenantId,
          patientId: u.p.id,
          surgeryId: created.id,
          invoiceNumber: `2026-${opInvoiceSeq++}`,
          status: u.invoice.status,
          currency: 'TJS',
          subtotal: u.invoice.total,
          total: u.invoice.total,
          createdById: demoUser.id,
          notes: 'demo-s16-op',
        },
        select: { id: true },
      });
      // Yönetici onayı bekleyen indirim (Onay Talepleri / Bekleyen İndirim
      // Onayları): premium trifokal paket bilateral, satışçı self-cap üstü %22
      // indirim verdi → yönetici onayında. Liste 42.000 → indirimli 32.760
      // (klinik kaybı 9.240). createdAt dün 16:42 ("Dün 16:42" rozeti).
      if (u.invoice.status === 'pending_approval') {
        await prisma.discountApproval.create({
          data: {
            tenantId,
            invoiceId: inv.id,
            surgeryId: created.id,
            requestedById: salesUser?.id ?? demoUser.id,
            discountPercent: '22.00',
            discountAmount: '9240.00',
            reason: 'Hasta başka klinikten 35.000 TJS teklif almış, kaçırmak istemiyoruz.',
            status: 'pending',
            createdAt: inDaysAt(-1, 16, 42),
          },
        });
      }
    }
  }

  // S16 — Yönetici "Bugünkü tahsilat" KPI + dünden delta. Önce-öde-sonra-hizmet
  // gereği muayene/işlem tahsilatları (paid fatura + payment). Fatura no '2026-91xx'
  // (bugün) / '2026-92xx' (dün) → '2026-9' ailesi, üstteki reset bloğu otomatik
  // temizler (idempotent). Bugün 7.500 / dün 6.696 → +%12. Tümü TJS.
  const paymentMethods = ['cash', 'card', 'transfer'] as const;
  const collectionsToday = [400, 600, 1200, 800, 500, 1500, 2500];
  const collectionsYesterday = [1500, 2000, 1200, 1000, 996];
  const seedCollections = async (
    amounts: number[],
    when: (i: number) => Date,
    baseNumber: number,
  ) => {
    for (let i = 0; i < amounts.length; i++) {
      const p = patients[i % patients.length]!;
      const amount = amounts[i]!.toFixed(2);
      const inv = await prisma.invoice.create({
        data: {
          tenantId,
          patientId: p.id,
          invoiceNumber: `2026-${baseNumber + i}`,
          status: 'paid',
          currency: 'TJS',
          subtotal: amount,
          total: amount,
          createdById: demoUser.id,
          notes: 'demo-s16-collection',
        },
        select: { id: true },
      });
      await prisma.payment.create({
        data: {
          tenantId,
          invoiceId: inv.id,
          amount,
          currency: 'TJS',
          tjsEquivalent: amount,
          method: paymentMethods[i % paymentMethods.length],
          takenById: demoUser.id,
          takenAt: when(i),
        },
      });
    }
  };
  await seedCollections(collectionsToday, (i) => todayAt(8 + i, 5), 9101);
  await seedCollections(collectionsYesterday, (i) => inDaysAt(-1, 9 + i, 10), 9201);

  // S15 — Asistan hemşire demo: hemsire.demo'yu bu doktora (doktor.demo) bağlayan
  // AKTİF NurseAssistanceSession. Hemşire login olunca asiste ettiği doktorun
  // Muayene Sırası + hastaları DOLU görünür (server-side acting-doctor scope).
  // Idempotent: nurse'ün açık session'larını kapat, yeni aktif satır aç.
  // (Session tarih-bağlı değil; worklist encounter'ları tarih-bağlı — seed:s15
  // her çalıştığında tazelenir.)
  const nurseUser = await prisma.user.findFirst({
    where: { tenantId, email: 'hemsire.demo@demoeye.tj', deletedAt: null },
    select: { id: true },
  });
  let nurseLinked = false;
  if (nurseUser) {
    await prisma.nurseAssistanceSession.updateMany({
      where: { tenantId, nurseId: nurseUser.id, endedAt: null, revokedAt: null },
      data: { endedAt: new Date() },
    });
    const session = await prisma.nurseAssistanceSession.create({
      data: {
        tenantId,
        nurseId: nurseUser.id,
        doctorId: demoUser.id,
        reason: 'Demo: asistan hemşire akışı (seed-s15)',
      },
    });
    nurseLinked = true;

    // #389 — demo: hemşire adına yapılmış birkaç BEKLEYEN co-sign (doktor onaylar).
    // Gerçek entity'lere bağlı ki CosignPage hasta (ad+MRN) + özet zenginleştirmesi
    // görünsün. Idempotent: bu doktora ait bekleyen cosign'ları temizle, yeniden kur.
    await prisma.auditLog.deleteMany({
      where: { tenantId, onBehalfOfUserId: demoUser.id, cosignedAt: null },
    });
    const patientIds = patients.map((p) => p.id);
    const [cosignMeas, cosignExam] = await Promise.all([
      prisma.measurement.findMany({
        where: { tenantId, patientId: { in: patientIds } },
        select: { id: true },
        take: 2,
        orderBy: { measuredAt: 'desc' },
      }),
      prisma.examination.findFirst({
        where: { tenantId, patientId: { in: patientIds } },
        select: { id: true },
        orderBy: { examinedAt: 'desc' },
      }),
    ]);
    const cosignRows = [
      ...cosignMeas.map((m) => ({
        entityType: 'measurement',
        entityId: m.id,
        action: 'trpc:measurement.create',
      })),
      ...(cosignExam
        ? [
            {
              entityType: 'examination',
              entityId: cosignExam.id,
              action: 'trpc:examination.create',
            },
          ]
        : []),
    ];
    if (cosignRows.length > 0) {
      await prisma.auditLog.createMany({
        data: cosignRows.map((r) => ({
          tenantId,
          userId: nurseUser.id,
          onBehalfOfUserId: demoUser.id,
          nurseSessionId: session.id,
          action: r.action,
          entityType: r.entityType,
          entityId: r.entityId,
          payload: { method: 'POST', path: `/api/trpc/${r.entityType}.create` },
        })),
      });
    }
  } else {
    console.warn('[seed-s15] hemsire.demo yok — asistan hemşire session atlandı (önce seed:demo)');
  }

  return { assigned, encounters, nurseLinked };
}

async function main() {
  assertSeedAllowed('seed-s15');
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: TENANT_SLUG } });
  console.warn(`[seed-s15] tenant: ${tenant.slug} (${tenant.id})`);

  const stock = await seedIolStockAndKits(tenant.id);
  console.warn(
    `[seed-s15] iol: ${stock.models.length} models, ${stock.lots.length} lots, ${stock.kits.length} kits`,
  );

  const thresholdCount = await seedLabThresholds(tenant.id);
  console.warn(`[seed-s15] lab thresholds: ${thresholdCount}`);

  const consumableCount = await seedConsumables(tenant.id);
  console.warn(`[seed-s15] consumables: ${consumableCount}`);

  const wl = await seedDoctorWorklistDemo(tenant.id, stock);
  console.warn(
    `[seed-s15] doktor menüsü demo: ${wl.assigned} hasta atandı, ${wl.encounters} encounter (Muayene Sırası), asistan hemşire: ${wl.nurseLinked ? 'bağlandı' : 'atlandı'}`,
  );

  console.warn('[seed-s15] done ✓');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
