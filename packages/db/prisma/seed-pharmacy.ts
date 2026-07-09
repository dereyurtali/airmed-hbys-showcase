/* eslint-disable no-console */
//
// v0.4 #562 — Eczane perakende + Satın Alma Siparişi örnek verisi (ayrı dosya).
// demoeye-dushanbe tenant'ı için gerçekçi göz-kliniği eczane stoğu + sipariş.
// Idempotent: deterministik UUID + upsert (tekrar koşunca çoğaltmaz).
//
// Çalıştır: npm run -w @airmed/db db:seed:pharmacy
//
import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import { assertSeedAllowed } from './_seed-guard';

const prisma = new PrismaClient();
const TENANT_SLUG = 'demoeye-dushanbe';

function did(seed: string): string {
  const h = createHash('sha256').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
function daysFromNow(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(0, 0, 0, 0);
  return d;
}

const SUPPLIERS = [
  {
    key: 'farma',
    name: 'Farma Düşanbe Tedarik',
    category: 'pharmacy' as const,
    phone: '+992 37 221 4455',
  },
  {
    key: 'alcon',
    name: 'Alcon Distribütör TJ',
    category: 'pharmacy' as const,
    phone: '+992 37 224 7788',
  },
  {
    key: 'medoptik',
    name: 'MedOptik Optik Malzeme',
    category: 'optic' as const,
    phone: '+992 37 227 1122',
  },
];

const PRODUCTS = [
  {
    key: 'systane',
    code: 'SYS-UL',
    name: 'Systane Ultra Göz Damlası',
    cat: 'drug',
    unit: 'kutu',
    sale: 65,
    cost: 42,
    qty: 40,
    rx: false,
  },
  {
    key: 'tobradex',
    code: 'TOB-DX',
    name: 'Tobradex Göz Damlası',
    cat: 'drug',
    unit: 'şişe',
    sale: 95,
    cost: 60,
    qty: 25,
    rx: true,
  },
  {
    key: 'vigamox',
    code: 'VIG-05',
    name: 'Vigamox %0.5 Damla',
    cat: 'drug',
    unit: 'şişe',
    sale: 110,
    cost: 72,
    qty: 18,
    rx: true,
  },
  {
    key: 'refresh',
    code: 'RFR-TR',
    name: 'Refresh Tears Suni Gözyaşı',
    cat: 'drug',
    unit: 'kutu',
    sale: 48,
    cost: 30,
    qty: 60,
    rx: false,
  },
  {
    key: 'lenssol',
    code: 'LNS-360',
    name: 'Lens Solüsyonu 360 ml',
    cat: 'supply',
    unit: 'şişe',
    sale: 55,
    cost: 33,
    qty: 35,
    rx: false,
  },
  {
    key: 'mendil',
    code: 'EYE-WP',
    name: 'Steril Göz Mendili (50li)',
    cat: 'supply',
    unit: 'paket',
    sale: 22,
    cost: 12,
    qty: 80,
    rx: false,
  },
];

async function main() {
  assertSeedAllowed('seed-pharmacy');
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: TENANT_SLUG } });
  const tenantId = tenant.id;
  const admin = await prisma.user.findFirst({ where: { tenantId }, select: { id: true } });
  const createdById = admin?.id ?? null;
  console.warn(`[seed-pharmacy] tenant: ${tenant.slug} (${tenantId})`);

  const supplierIds: Record<string, string> = {};
  for (const s of SUPPLIERS) {
    const id = did(`supplier:${tenantId}:${s.key}`);
    supplierIds[s.key] = id;
    await prisma.supplier.upsert({
      where: { id },
      update: {},
      create: {
        id,
        tenantId,
        name: s.name,
        category: s.category,
        contactPhone: s.phone,
        isActive: true,
      },
    });
  }

  const productIds: Record<string, string> = {};
  for (const p of PRODUCTS) {
    const id = did(`pharmacy-product:${tenantId}:${p.key}`);
    productIds[p.key] = id;
    await prisma.pharmacyProduct.upsert({
      where: { id },
      update: {},
      create: {
        id,
        tenantId,
        code: p.code,
        name: p.name,
        category: p.cat,
        unit: p.unit,
        requiresPrescription: p.rx,
        isActive: true,
      },
    });
    const batchId = did(`pharmacy-batch:${tenantId}:${p.key}`);
    await prisma.pharmacyBatch.upsert({
      where: { id: batchId },
      update: {},
      create: {
        id: batchId,
        tenantId,
        productId: id,
        lotNumber: `LOT-${p.code}-26`,
        expiresAt: daysFromNow(540),
        costPrice: p.cost,
        salePrice: p.sale,
        currency: 'TJS',
        availableQty: p.qty,
        supplierId: supplierIds.farma,
        receivedAt: daysFromNow(-30),
      },
    });
  }

  // Satın Alma Siparişi örnekleri: eczane (alınmış) + klinik (onay bekliyor).
  const poPharmacy = did(`po:${tenantId}:pharmacy-1`);
  await prisma.purchaseOrder.upsert({
    where: { id: poPharmacy },
    update: {},
    create: {
      id: poPharmacy,
      tenantId,
      orderNo: 'PO-2026-90001',
      supplierId: supplierIds.alcon,
      domain: 'pharmacy',
      status: 'received',
      currency: 'TJS',
      totalAmount: 2160,
      approvalThreshold: 10000,
      createdById,
      submittedAt: daysFromNow(-10),
      receivedAt: daysFromNow(-7),
      items: {
        create: [
          {
            tenantId,
            itemName: 'Tobradex Göz Damlası',
            referenceType: 'pharmacy_product',
            referenceId: productIds.tobradex,
            quantity: 24,
            unitPrice: 60,
            lineTotal: 1440,
            receivedQty: 24,
          },
          {
            tenantId,
            itemName: 'Vigamox %0.5 Damla',
            referenceType: 'pharmacy_product',
            referenceId: productIds.vigamox,
            quantity: 10,
            unitPrice: 72,
            lineTotal: 720,
            receivedQty: 10,
          },
        ],
      },
    },
  });

  const poClinic = did(`po:${tenantId}:clinic-1`);
  await prisma.purchaseOrder.upsert({
    where: { id: poClinic },
    update: {},
    create: {
      id: poClinic,
      tenantId,
      orderNo: 'PO-2026-90002',
      supplierId: supplierIds.medoptik,
      domain: 'clinic',
      status: 'pending_approval',
      currency: 'TJS',
      totalAmount: 12500,
      approvalThreshold: 10000,
      createdById,
      submittedAt: daysFromNow(-2),
      items: {
        create: [
          {
            tenantId,
            itemName: 'IOL Monofocal Set',
            quantity: 25,
            unitPrice: 500,
            lineTotal: 12500,
            receivedQty: 0,
          },
        ],
      },
    },
  });

  console.warn(
    `[seed-pharmacy] ✓ tedarikçi: ${SUPPLIERS.length}, ürün+parti: ${PRODUCTS.length}, sipariş: 2`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
