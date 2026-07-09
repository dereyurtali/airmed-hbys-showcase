import { describe, it, expect } from 'vitest';
import guideTr from '../i18n/locales/guide.tr.json';
import guideRu from '../i18n/locales/guide.ru.json';
import guideTg from '../i18n/locales/guide.tg.json';
import { resolveGuideScreenKey, guideVariantKey, GUIDE_SCREEN_KEYS } from './guide-resolver';
import { TOP_LEVEL_BY_VARIANT } from './sidebar-variant';
import type { SidebarVariant } from './sidebar-variant';

// #1080 — Kılavuz kalite kapısı: sıfır-skip kapsam + 3-dil parity + şema.
// Yeni ekran/rota ekleyen dev bu testi kırmızı görür → kılavuz yazmadan
// merge edemez (sidebar-top-level.sync.test.ts deseninin ikizi).

type ScreenGuide = {
  title?: string;
  purpose?: string;
  tasks?: { title: string; steps: string[] }[];
};
type GuideDoc = Record<string, Record<string, ScreenGuide>>;

const DOCS: Record<'tr' | 'ru' | 'tg', GuideDoc> = {
  tr: guideTr as GuideDoc,
  ru: guideRu as GuideDoc,
  tg: guideTg as GuideDoc,
};

// Bir (varyant, screenKey) için içerik: guide.<variantKey>.<screen> → guide.default.<screen>.
function lookup(doc: GuideDoc, variantKey: string, screenKey: string): ScreenGuide | null {
  const v = doc[variantKey]?.[screenKey];
  if (v && v.title) return v;
  const d = doc.default?.[screenKey];
  if (d && d.title) return d;
  return null;
}

const VARIANTS = Object.keys(TOP_LEVEL_BY_VARIANT) as SidebarVariant[];

describe('guide kapsam — her (varyant, top-level rota) içerik ZORUNLU (sıfır-skip)', () => {
  for (const variant of VARIANTS) {
    const variantKey = guideVariantKey(variant);
    for (const route of TOP_LEVEL_BY_VARIANT[variant]) {
      it(`${variant} · ${route} → içerik (3 dil)`, () => {
        const screenKey = resolveGuideScreenKey(route);
        expect(screenKey, `resolver ${route} için screenKey döndürmeli`).toBeTruthy();
        for (const [lng, doc] of Object.entries(DOCS)) {
          const g = lookup(doc, variantKey, screenKey!);
          expect(
            g,
            `${lng}: guide.${variantKey}.${screenKey} veya guide.default.${screenKey} olmalı`,
          ).toBeTruthy();
          expect(g!.title, `${lng} ${screenKey} title`).toBeTruthy();
          expect(g!.purpose, `${lng} ${screenKey} purpose`).toBeTruthy();
          expect(Array.isArray(g!.tasks) && g!.tasks!.length > 0, `${lng} ${screenKey} tasks`).toBe(
            true,
          );
          for (const task of g!.tasks!) {
            expect(task.steps.length, `${lng} ${screenKey} task steps boş olamaz`).toBeGreaterThan(
              0,
            );
          }
        }
      });
    }
  }
});

// Nested key setini düzleştir ("variant.screen.field" yolları).
function flatKeys(obj: unknown, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object') return [prefix];
  if (Array.isArray(obj)) return obj.flatMap((v, i) => flatKeys(v, `${prefix}[${i}]`));
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    flatKeys(v, prefix ? `${prefix}.${k}` : k),
  );
}

// #guide-coverage-gaps — resolver'ın ürettiği HER screenKey'in içeriği olmalı
// (default'ta veya bir varyantta). Aksi halde o rota "comingSoon" gösterir.
// Top-level olmayan ekranlar (detay/form/hub-altı) da bu testle korunur.
describe('guide resolver screenKey kapsamı (comingSoon guard)', () => {
  for (const screenKey of GUIDE_SCREEN_KEYS) {
    it(`${screenKey} — en az bir dilde default içeriği var`, () => {
      for (const [lng, doc] of Object.entries(DOCS)) {
        const inDefault = doc.default?.[screenKey];
        const inAnyVariant = Object.entries(doc).some(
          ([vk, screens]) => vk !== 'meta' && vk !== 'default' && screens[screenKey]?.title,
        );
        expect(
          (inDefault && inDefault.title) || inAnyVariant,
          `${lng}: '${screenKey}' hiçbir varyantta ve default'ta yok → comingSoon`,
        ).toBeTruthy();
      }
    });
  }
});

describe('guide 3-dil parity', () => {
  it('tr/ru/tg key setleri birebir eşit', () => {
    const tr = new Set(flatKeys(guideTr));
    const ru = new Set(flatKeys(guideRu));
    const tg = new Set(flatKeys(guideTg));
    const missingRu = [...tr].filter((k) => !ru.has(k));
    const missingTg = [...tr].filter((k) => !tg.has(k));
    const extraRu = [...ru].filter((k) => !tr.has(k));
    const extraTg = [...tg].filter((k) => !tr.has(k));
    expect({ missingRu, extraRu, missingTg, extraTg }).toEqual({
      missingRu: [],
      extraRu: [],
      missingTg: [],
      extraTg: [],
    });
  });

  it('TG özel karakterleri korunmuş (Ӣ Қ Ҳ Ҷ Ӯ Ғ set kapsamı)', () => {
    const blob = JSON.stringify(guideTg);
    // Tacik metninde bu karakterlerden en az biri geçmeli (subset regresyon guard).
    expect(/[ӢҚҲҶӮҒ]/.test(blob)).toBe(true);
  });
});

describe('guide şema — her entry title+purpose+tasks (boş steps yok)', () => {
  it('tüm dillerde tüm entry’ler şemaya uygun', () => {
    for (const [lng, doc] of Object.entries(DOCS)) {
      for (const [variantKey, screens] of Object.entries(doc)) {
        if (variantKey === 'meta') continue;
        for (const [screenKey, g] of Object.entries(screens)) {
          expect(g.title, `${lng}.${variantKey}.${screenKey}.title`).toBeTruthy();
          expect(g.purpose, `${lng}.${variantKey}.${screenKey}.purpose`).toBeTruthy();
          expect(
            Array.isArray(g.tasks) && g.tasks.length > 0,
            `${lng}.${variantKey}.${screenKey}.tasks`,
          ).toBe(true);
          for (const task of g.tasks!) {
            expect(task.steps.length, `${lng}.${variantKey}.${screenKey} steps`).toBeGreaterThan(0);
          }
        }
      }
    }
  });
});
