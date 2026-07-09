# AirMed-HBYS API image (NestJS + Prisma) — monorepo-safe.
#
# Builder, CI/runner ile BİREBİR kurar: tek temiz `npm ci` (tüm workspace
# manifest'leri) → `db:generate` → build db → build api. Böylece `@airmed/db`
# workspace symlink'i + generate'lenmiş `@prisma/client` doğru resolve olur.
# (Eski 3-katmanlı cross-stage `node_modules` COPY'si bunu bozuyordu →
#  "Cannot find module '@airmed/db'" + 226 tip hatası.)
#
# Not: runtime imajı dev bağımlılıkları + kaynağı içerir (basit + doğru).
# Prod için ileride slim multi-stage'e dönülebilir; şimdilik öncelik çalışan image.

# ---- builder (CI ile birebir) ----
FROM node:20-alpine AS builder
WORKDIR /repo
# openssl: Prisma engine · python3/make/g++: bcrypt gibi native modülleri alpine'da derlemek için
RUN apk add --no-cache openssl python3 make g++
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/db/package.json ./packages/db/
COPY packages/observability/package.json ./packages/observability/
COPY apps/web/package.json ./apps/web/
COPY apps/admin/package.json ./apps/admin/
RUN CI=true npm ci --ignore-scripts
COPY packages/contracts/ ./packages/contracts/
COPY packages/db/ ./packages/db/
COPY packages/observability/ ./packages/observability/
COPY apps/api/ ./apps/api/
# Defensive: host'tan sızabilecek incremental tsc state'i sil → her zaman temiz emit
# (yoksa bayat *.tsbuildinfo → tsc skip-emit → packages/db/dist yok → "@airmed/db" çözülemez)
RUN find . -name '*.tsbuildinfo' -delete \
 && npm rebuild bcrypt \
 && npm run db:generate \
 && npm run build --workspace=@airmed/contracts \
 && npm run build --workspace=@airmed/db \
 && npm run build --workspace=@airmed/observability \
 && npm run build --workspace=@airmed/api

# ---- runtime ----
FROM node:20-alpine AS runtime
WORKDIR /repo
RUN apk add --no-cache openssl tini \
 && addgroup -S nodejs && adduser -S nestjs -G nodejs
COPY --from=builder --chown=nestjs:nodejs /repo ./
# Yüklenen dosyalar (klinik logosu, hasta foto C3) için yazılabilir dizin. `/repo` root-owned
# kaldığından nestjs orada mkdir yapamaz (EACCES) → STORAGE_LOCAL_PATH=/data ile sahibi nestjs
# olan ayrı dizine yazılır; compose'da named volume mount'lanınca redeploy'da kalıcı olur.
RUN mkdir -p /data && chown nestjs:nodejs /data
USER nestjs
ENV NODE_ENV=production
ENV PORT=3001
# #955 — Sürüm/deploy görünürlüğü: build-arg'lar image'a gömülür → /platform/health/
# snapshot bunları raporlar (hangi commit hangi ortamda çalışıyor). docker-build.yml
# GIT_SHA=${{ github.sha }} + BUILD_TIME + IMAGE_TAG geçirir.
ARG GIT_SHA=""
ARG IMAGE_TAG=""
ARG BUILD_TIME=""
ENV GIT_SHA=$GIT_SHA
ENV IMAGE_TAG=$IMAGE_TAG
ENV BUILD_TIME=$BUILD_TIME
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:3001/api/health || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/api/dist/main.js"]
