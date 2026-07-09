-- #1055 hasta/fatura arama performansı — index'siz OR kolu düzeltmesi.
--
-- patient.list searchFilter 4 kollu OR kullanır (firstName/lastName/mrn trgm'li,
-- phoneLast4 contains index'siz). Postgres bir OR bloğunu ancak TÜM kollar
-- index'liyse BitmapOr ile çözer; tek index'siz kol tüm sorguyu seq scan'e
-- düşürür ve mevcut trgm GIN'leri israf eder. Aynı mekanizma invoice.list
-- aramasındaki invoiceNumber ILIKE '%q%' için de geçerli (unique btree
-- contains'i kapsamaz).
--
-- pg_trgm extension 20260505190118_init_multitenant'ta enable edildi.
-- CREATE INDEX IF NOT EXISTS migration replay güvenliği için.

CREATE INDEX IF NOT EXISTS "patients_phone_last4_trgm"
  ON "patients" USING gin ("phone_last4" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "invoices_invoice_number_trgm"
  ON "invoices" USING gin ("invoice_number" gin_trgm_ops);
