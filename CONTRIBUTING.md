# Contributing to AirMed-HBYS

## Setup

```bash
docker compose up -d
npm install
cp .env.example .env
npm run db:generate
npm run db:migrate
npm run dev
```

## Branch naming

| Pattern | Use for |
|---------|---------|
| `feat/<scope>-<short>` | Yeni özellik |
| `fix/<scope>-<short>` | Bug fix |
| `refactor/<scope>` | Refactoring |
| `chore/<short>` | Bağımlılık, config, tooling |
| `docs/<short>` | Dokümantasyon |

## Commit format

Conventional commits — `commitlint` ile enforce.

```
<type>(<scope>): <subject>

[body]

[footer]
```

Örnek: `feat(patients): add inline registration form`

## PR checklist (before merge)

- [ ] CI yeşil (lint + typecheck + test + build)
- [ ] Local'de manuel test edildi
- [ ] PR template dolduruldu
- [ ] 1 reviewer approval var
- [ ] Conflict yok

## Code review

- Max 30 dk içinde review
- Style yorumu yok (Prettier+ESLint halletsin)
- Mantık, mimari, security üzerine odaklan
- "Nice-to-have" yorumlarını `nit:` prefix ile işaretle

## Local DB reset

```bash
docker compose down -v
docker compose up -d
npm run db:migrate
npm run db:seed
```
