-- A12 user_roles sync trigger fix (denetim P0 #2.5).
--
-- Önceki migration 20260524190530 user_roles için trigger'ı DROP etmişti:
-- composite PK (tenant_id, user_id, role_id) sync_outbox_record() function
-- ile uyumsuzdu (function NEW.id arıyor). Sonuç: rol değişiklikleri buluta
-- sync edilmiyor — lokal sunucuda revoke → buluta gitmez → yetki tutarsızlığı.
--
-- Çözüm: user_roles tablosuna `id UUID` ekle, composite anahtarı UNIQUE
-- constraint olarak koru, mevcut sync_outbox_record() function ile trigger
-- ekle. Mevcut satırlara DEFAULT gen_random_uuid() ile id atanır.

ALTER TABLE "user_roles"
  ADD COLUMN "id" UUID NOT NULL DEFAULT gen_random_uuid();

-- Composite PK → UNIQUE constraint (FK relations etkilenmez; UserRole'a
-- foreign key pointing yok, sadece UserRole'dan üç FK out var).
ALTER TABLE "user_roles" DROP CONSTRAINT "user_roles_pkey";
ALTER TABLE "user_roles"
  ADD CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id");
ALTER TABLE "user_roles"
  ADD CONSTRAINT "user_roles_tenant_user_role_unique"
  UNIQUE ("tenant_id", "user_id", "role_id");

-- Artık composite key tablosu değil, normal sync_outbox_record() kullanılabilir.
CREATE TRIGGER "user_roles_sync_outbox"
  AFTER INSERT OR UPDATE OR DELETE ON "user_roles"
  FOR EACH ROW EXECUTE FUNCTION sync_outbox_record('userRole');
