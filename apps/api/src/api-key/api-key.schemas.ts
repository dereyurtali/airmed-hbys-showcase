import { z } from 'zod';

// A10 dış API — ApiKey admin CRUD şemaları.
//
// Scope literal listesi: dış API'nin kapasitesi. Geri kalan tıbbi veriye
// (muayene, ameliyat, ölçüm, reçete) erişim KASITLI olarak yok — A10 plan
// "tıbbi veri yok" prensibinin schema tarafından zorlanması.
//
// Anahtar üretim akışı service'de:
//   1. crypto.randomBytes(32).toString('hex') → 64-char plaintext
//   2. format "ak_{tenantSlug}_{plaintext}" → kullanıcıya bir kez gösterilir
//   3. SHA-256 hash DB'de; raw plaintext SAKLANMAZ
//   4. prefix (ilk 12 char) UI'da identifier (geri kalan maskelidir)

export const apiScopes = [
  'patient:read',
  'patient:create',
  'patient:update',
  'appointment:read',
  'appointment:create',
  'appointment:cancel',
  'availability:read',
] as const;

export const apiScopeSchema = z.enum(apiScopes);
export type ApiScope = z.infer<typeof apiScopeSchema>;

const isoDateTime = z.string().datetime({ offset: true });

export const apiKeyCreateSchema = z.object({
  name: z.string().min(2).max(100),
  scopes: z.array(apiScopeSchema).min(1, 'En az bir scope seçilmeli'),
  rateLimit: z.coerce.number().int().min(1).max(100_000).default(1000),
  expiresAt: isoDateTime.optional().nullable(),
});

export const apiKeyUpdateSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  scopes: z.array(apiScopeSchema).min(1).optional(),
  rateLimit: z.coerce.number().int().min(1).max(100_000).optional(),
  expiresAt: isoDateTime.optional().nullable(),
  isActive: z.boolean().optional(),
});

export type ApiKeyCreateInput = z.infer<typeof apiKeyCreateSchema>;
export type ApiKeyUpdateInput = z.infer<typeof apiKeyUpdateSchema>;
