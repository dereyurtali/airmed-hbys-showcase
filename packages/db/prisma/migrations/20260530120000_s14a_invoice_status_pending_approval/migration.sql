-- S14a — v0.1 indirim onayı port: InvoiceStatus enum'a pending_approval ekler.
--
-- NOTE: Postgres ALTER TYPE ADD VALUE aynı tx'te kullanılamaz (S12b'deki
-- aynı kısıt). Bu migration sadece enum genişletir; pending_approval'ı
-- kullanan service/index/table değişiklikleri 20260530120100_s14b_v01_port'ta.
--
-- pending_approval = kullanıcının rol cap'ini aşan indirimle açılan fatura,
-- review tamamlanana kadar bekler. Onay → open/partial/paid; red → cancelled.

ALTER TYPE "InvoiceStatus" ADD VALUE IF NOT EXISTS 'pending_approval';
