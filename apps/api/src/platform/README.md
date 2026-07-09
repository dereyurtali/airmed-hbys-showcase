# Platform Module

> **F serisi** — DNA Software Solutions platform yönetim katmanı.
> Klinik kullanıcılarına AÇIK DEĞİL. `admin.dnasoft.co` subdomain üzerinden erişilir.

## Modül Haritası

| F#  | Klasör                                             | İçerik                                                 | Hafta |
| --- | -------------------------------------------------- | ------------------------------------------------------ | ----: |
| F2  | `auth/`                                            | Super-admin auth (TOTP, IP allowlist, ayrı JWT secret) |     2 |
| F3  | `tenants/`                                         | Tenant CRUD + onboarding wizard + suspend              |    18 |
| F4  | `audit/`, `impersonation/`                         | Audit log + impersonation flow                         |    19 |
| F5  | `health/`                                          | System health + metrics + alerts                       |    19 |
| F6  | `feature-flags/`, `maintenance/`, `announcements/` | Flags + maintenance mode + broadcast                   |    19 |

## Genel Kurallar

1. **Endpoint prefix:** `/platform/...` (klinik `/api/...` ile karışmaz)
2. **Auth:** Ayrı `PlatformJwtStrategy` + `PLATFORM_JWT_SECRET` env
3. **Guard:** `PlatformIpAllowlistGuard` + `PlatformAuthGuard` her endpoint'te (global)
4. **Audit:** Her hassas action `audit_log`'a yazılır (`actor_type='platform_admin'`)

## Detay

Plan referansları: `~/Documents/AirMed-HBYS/gelistirme-plani/03-moduller/F-platform/`
