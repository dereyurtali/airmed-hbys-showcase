/**
 * S5 — Rol üstü user bayrakları (karar tutanağı §3). Doktor user için:
 *  - is_visiting_doctor: misafir cerrah; sadece kendi cerrahileri görür
 *    (PatientService.list filter; can_see_all_patients'i override eder)
 *  - can_see_all_patients: yönetici override; baş hekim için sıkı izolasyon kalkar
 * Diğer flag'ler şema değişikliği olmadan eklenebilir.
 */
export interface UserFlags {
  is_visiting_doctor?: boolean;
  can_see_all_patients?: boolean;
  // v0.4 (#538) — Kullanıcının seçebildiği çalışma modları. Hemşire için
  // tipik: ['genel','asistan'] veya kilitli ölçüm kiosk'u için ['olcum'].
  // Login'de >1 mod varsa seçici çıkar, =1 ise otomatik seçilir (#539/#540).
  // undefined/boş = mod kavramı olmayan roller (klasik davranış).
  modes?: string[];
}

export interface JwtPayload {
  sub: string;
  tenantId: string;
  email: string;
  roles: string[];
  // F4 — impersonation: bu alan dolu ise token'ı bir platform admin başka
  // bir kullanıcının kimliğiyle aldı; her istekte impersonation row geçerli
  // mi diye DB lookup'ı yapılır (anında revoke için).
  imp?: ImpersonationClaim;
  // S5 — User.flags (db'den okunup login zamanında JWT'ye gömülür). Undefined
  // mevcut user'lar için (default davranış değişmez).
  flags?: UserFlags;
  // PermissionAssignment runtime entegrasyonu — login/refresh sırasında
  // tenant override'ları registry ile birleştirilip kullanıcının "etkili"
  // izin seti hesaplanır ve JWT'ye gömülür. PermissionGuard önce buna bakar,
  // bulamazsa rol-tabanlı registry kontrolüne düşer (geriye uyumlu).
  // Override değişiklikleri max access token TTL kadar gecikmeyle yansır
  // (~15 dk) veya kullanıcı logout/login ile anında geçer.
  // Undefined = legacy token (deploy öncesi); fallback path devreye girer.
  effectivePerms?: string[];
  // v0.4 — Çalışma modu (#537). Girişte seçilen "bugün hangi işteyim" bilgisi.
  // Kilitli mod (örn. 'olcum' = ölçüm kiosk'u) ise `effectivePerms` zaten o
  // moda ait alt-kümeye daraltılmış olarak gömülür (computeEffectivePermissions
  // mode argümanı). Mod kavramı olmayan roller için undefined (klasik davranış).
  mode?: string;
}

export interface ImpersonationClaim {
  // tenant_impersonations.id — strategy lookup ediyor; ended_at IS NULL +
  // expires_at > now() kontrolü yapıyor. Aksi durumda token reddedilir.
  id: string;
  // Platform admin id — audit log + UI banner için
  by: string;
  // Platform admin display adı — UI banner için (denormalize, JWT'ye gömülü)
  byName: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}
