# Realistic Seed Data Spec — Tek Doğru Kaynak

Bu doküman `db:seed:realistic`'in (ve geleceğe eklenecek seed parçalarının) **veri standartlarını** kanonik olarak tanımlar. Implementasyon: [seed-realistic.ts](./seed-realistic.ts). Yeni modül için seed eklerken bu spec'e bak; "0000", "Test Hasta", "Demo XYZ" placeholder **YASAK**.

Memory bağlamı: [.claude/memory/feedback_post_change_bring_up.md](../../../.claude/memory/feedback_post_change_bring_up.md) (Ali, 2026-05-30).

---

## 1. Genel Prensipler

| Kural               | Davranış                                                                                           |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| **Tek tenant**      | `demoeye-dushanbe` (slug). Çok-tenant senaryosu lazımsa ayrı `seed-multi-tenant.ts`.               |
| **Idempotent**      | Deterministik UUID (`did(seed:string)` SHA-256 üretici) + Prisma `upsert`. Tekrar = aynı veri.     |
| **Bugün referansı** | `daysAgo(n)` helper'ı — geçmiş/gelecek tarihler her çalıştırışta "bugün"e göre yeniden hesaplanır. |
| **Tarih dağılımı**  | Geçmiş 4 hafta + bugün + gelecek 2 hafta — randevu sayfası boş görünmesin.                         |
| **Cyrillic UTF-8**  | Tacik özel karakterleri (Ӣ Қ Ҳ Ҷ Ӯ Ғ) seed'de mutlaka kullan → i18n + font subset testi.           |
| **Yasak değerler**  | `"Test"`, `"Demo"`, `"Hasta 1"`, `"0000"`, `"+90 555 555 5555"`, sıfır/null ardışık MRN.           |

---

## 2. Hasta MRN Formatı (S13 Standardı — KANONİK)

**Format:** `<prefix(2)><yy(2)><check(1)><seq(5)>` — 10 karakter, çizgisiz.

- `prefix` = `Tenant.mrnPrefix` (DemoEye = `TD`)
- `yy` = yılın son 2 hanesi (2026 → `26`)
- `check` = Verhoeff checksum, `yy+seq` 7 hanesi üzerinden
- `seq` = `MrnCounter (tenantId, year)` atomik UPSERT RETURNING — race-free, yıl başında sıfırlanır

**Örnekler:** `TD26500001`, `TD26700042`, `TD26900030`

**Yasak alternatifler:** `TD-26-00001`, `TD00001`, `1`, `mrn-001`, ardışık sıfır.

**Eski 9-hane uyumluluğu:** `parseMrn` eski formatta null döner, `verhoeffValidate` çalışmaya devam eder. Yeni seed yalnız 10-char üretir.

---

## 3. Hasta Havuzu (30 kişi)

**Etnik dağılım (kasıtlı):** ~50% Tacik (Kiril), ~30% Türk (Latin), ~20% Rus (Kiril).

| Etnisite | Tipik isim örnekleri                                                            | Telefon prefix                                     |
| -------- | ------------------------------------------------------------------------------- | -------------------------------------------------- |
| Tacik    | Шарифа Каримова, Бахром Назаров, Ҷамшед Сафаров, Ӯктам Ғаниев, Дилноза Қодирова | `+992 9x ...`                                      |
| Türk     | Ayşe Yıldız, Mehmet Demir, Fatma Koç, Hasan Aydın                               | `+90 5xx ...` veya `+992` (Tacikistan'a yerleşmiş) |
| Rus      | Елена Петрова, Игорь Соколов, Ольга Иванова, Сергей Кузнецов, Анна Морозова     | `+992 9x ...`                                      |

**Cinsiyet dağılımı:** ~55% female, ~45% male.

**Yaş dağılımı (kasıtlı — oftalmolojik gerçekçilik):**

- ≥65 yaş (senior — katarakt, AMD, glokom adayları): ~40%
- 40-64 yaş (presbyopi, erken katarakt): ~35%
- 18-39 yaş (miyopi, refraktif): ~20%
- <18 yaş (pediatrik strabismus): ~5% (1-2 hasta)

**Lead source dağılımı (gerçek klinik karışımı):**

`doctor_referral`, `whatsapp`, `instagram`, `returning_patient`, `optic_partner`, `corporate_contract`, `telegram`, `walk_in`, `field_rep` — her biri en az 2-3 hasta.

**Notes alanı:** ~%40 hastada klinik anlamlı not (`"Bilateral senile cataract"`, `"OD glaucoma, takipte"`, `"Yüksek miyop, kontrol"`). Geri kalan boş — gerçek klinik kayıtları da boş not içerir.

**Havuz konumu:** [seed-realistic.ts L82-330](./seed-realistic.ts) (`PATIENT_POOL`).

**Yeni hasta eklerken:** yukarıdaki oranları koru, Latin/Kiril karışımını boz, gerçek bir 60'lı Tacik kadın için Шарифа/Гулнора tarzı isim seç, "Patient 31" YAZMA.

---

## 4. Doktor Havuzu (4 kişi)

| Key      | İsim                                            | Specialty             | Type       | Commission | User'a bağlı?              |
| -------- | ----------------------------------------------- | --------------------- | ---------- | ---------- | -------------------------- |
| rakhimov | Dr. Anvar Rakhimov                              | Ön Segment / Katarakt | `local`    | 30%        | ✓ `doktor.demo@demoeye.tj` |
| said     | Dr. Diana Said                                  | Retina / Vitreus      | `local`    | 30%        | — (profile-only)           |
| yildiz   | Prof. Dr. İsmail Yıldız (visiting, İstanbul)    | Refraktif Cerrahi     | `visiting` | 50%        | — (profile-only)           |
| saidov   | Dr. Khurshed Saidov (referral, regional clinic) | Genel Oftalmoloji     | `referral` | 10%        | — (profile-only)           |

**Availability:** sadece `local` doktorlar için Mon-Fri 09:00-17:00 slot'ları. Visiting/referral doktorlar yalnız randevu bazında atanır.

**Yeni doktor eklerken:** unvan + uzmanlık + type ayırt edici olsun. "Dr. X" tek başına yetersiz; "Dr. Anvar Rakhimov" ve specialty ile gerçeklik hissi verir.

---

## 5. Demo Kullanıcı Hesapları (Login Edilebilir)

**Şifre:** hepsi `demo12345` (bcrypt cost 12), `mustChangePassword=false` (direkt login).

**Klinik (`http://localhost:5173`):**

| Rol               | Email                      |
| ----------------- | -------------------------- |
| yonetici          | yonetici.demo@demoeye.tj   |
| yonetici_asistani | asistan.demo@demoeye.tj    |
| doktor            | doktor.demo@demoeye.tj     |
| resepsiyon        | resepsiyon.demo@demoeye.tj |
| hemsire           | hemsire.demo@demoeye.tj    |
| ameliyat_satis    | satis.demo@demoeye.tj      |

**Platform (`http://localhost:5174`):**

| Rol               | Email                    | Şifre                     |
| ----------------- | ------------------------ | ------------------------- |
| platform_engineer | engineer.demo@dnasoft.co | `demo12345`               |
| platform_support  | support.demo@dnasoft.co  | `demo12345`               |
| platform_owner    | ali@dnasoft.co           | `platform-owner-dev-pass` |
| platform_owner    | owner@dnasoft.co     | `platform-owner-dev-pass` |

**Lokasyon:** `seed-demo.ts`.

---

## 6. Randevu Dağılımı (131 randevu)

**Zaman penceresi:** geçmiş 4 hafta + bugün + gelecek 2 hafta.

**Status dağılımı (geçmiş randevular):**

- `completed`: ~80%
- `no_show`: ~10%
- `cancelled`: ~10%

**Status dağılımı (bugünkü randevular):**

- `checked_in` / `in_progress` / `scheduled` karışık (resepsiyon ekranı canlı görünsün).

**Status dağılımı (gelecek randevular):**

- Hepsi `scheduled`.

**Tip dağılımı:** `consultation` ağırlıklı + `follow_up` + `surgery_consult` karışık.

---

## 7. Muayene + Ölçüm

- **Muayene:** `completed` randevuların ~%75'i için tam doldurulmuş `Examination` (ICD-10 diagnosis, chief complaint, vital signs).
- **ICD-10 havuzu:** H25.13 (katarakt), H40.11 (POAG), H35.31 (AMD), H52.13 (miyop), H50.04 (esoforia), H10.9 (konjunktivit), H02.43 (pitozis), H43.31 (vitröz dejen.).
- **Ölçüm:** hasta başına 1-3 measurement, türler: `visual_acuity`, `intraocular_pressure`, `refraction`, `biometry`, `keratometry`. Değerler klinik açıdan tutarlı (snellen kesirleri, mmHg, sphere/cylinder/axis).

---

## 8. Cerrahi (11 ameliyat)

- **Tip:** `Phacoemulsification + IOL` (katarakt — Türk-Tacik klinik portföyünün ağırlığı).
- **Hasta seçimi:** yalnız 50+ yaş hastalar (ilk 10).
- **Status:** ~9 `performed` (son 3 ay) + ~2 `planned` (gelecek).
- **Doktor karışımı:** her 4. ameliyat `visiting` (Prof. Yıldız), kalanı local.
- **Komplikasyon:** 2 ameliyatta complication flag (gerçek oran ~2-3%; seed'de demo için biraz yüksek).
- **B1 alanları:** `eyeSide`, `anesthesiaType`, `surgeonRole`, `iolPosition`, `wound`, `plan` dolu.

---

## 9. Fatura / Tahsilat / Hakediş — **EKSİK (TODO)**

> **Status:** Şu an seed-realistic.ts'de `Invoice`, `Payment`, `Commission` üretilmiyor. Bu boşluk doldurulmalı çünkü "önce öde sonra hizmet" (S12c) + cerrahi binding (S12a) + auto-commission (S12b) kuralları realistic test için fatura verisi ister.

**Eklendiğinde uyulacak dağılım:**

| Kategori                                 | Adet (yaklaşık)                      | Status karışımı                                                                  |
| ---------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------- |
| Muayene faturaları (ServiceCategory)     | ~75 (her completed examination için) | %70 `paid`, %20 `partial`, %10 `pending`                                         |
| Lab faturaları                           | ~25                                  | %80 `paid`, %20 `partial`                                                        |
| Cerrahi faturaları (`surgeryId != null`) | 11                                   | %60 `paid`, %30 `partial`, %10 `pending` (cerrahi yüksek tutar → partial yaygın) |

**Tahsilat kanalları:** `cash` (ağırlıklı — Tacikistan), `card`, `bank_transfer`.

**Commission:** auto-calculate trigger'ı her examination/lab/measurement sonrası çalışır (`CommissionService.tryAutoCalculate`); seed sonunda doktor başına commission satırları üretilmiş olmalı.

**Eklerken kullanılacak rol:** Cerrahi fatura/tahsilat yalnız `SURGERY_BILLING_ROLES` (yonetici, yonetici_asistani, ameliyat_satis) tarafından (service-layer guard).

---

## 10. Yeni Modül Seed Eklerken Checklist

- [ ] Bu spec'i okudum, isim/oran/format kuralları aklımda
- [ ] Deterministik UUID (`did('module:key:...')`) kullandım, hardcode UUID yok
- [ ] Idempotent yazdım — `upsert` veya `try { create } catch P2002`
- [ ] Tarihler `daysAgo()` ile relatif, `new Date('2026-05-15')` hardcode yok
- [ ] İsimler/şirketler/IDler Cyrillic + Latin karışımı, gerçek görünümlü
- [ ] Status/oran dağılımı tek değere kilitlenmemiş (sadece "paid" değil — karışım)
- [ ] Service-layer kuralları (S12a/S12b/S12c, S13) ihlal edilmiyor
- [ ] Spec'in 11. bölümüne kayıt ekledim (aşağıda)

---

## 11. Değişiklik Geçmişi

| Tarih      | Değişiklik                                                              | Yapan |
| ---------- | ----------------------------------------------------------------------- | ----- |
| 2026-05-30 | İlk versiyon — 30 hasta / 4 doktor / 131 randevu / 11 cerrahi standardı | Ali   |
| 2026-05-30 | Bölüm 9 (fatura/tahsilat/commission) TODO olarak işaretlendi            | Ali   |
