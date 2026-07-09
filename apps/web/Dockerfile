# A15 — Production web image (React/Vite → nginx static serve).
#
# Multi-stage:
#   1. builder → Vite production build (assets fingerprint'li)
#   2. runtime → nginx-alpine, /usr/share/nginx/html'a kopya, SPA fallback
#
# API + WebSocket proxy nginx katmanında (PR 2'de). Bu image yalnız static
# assets serve eder.

# ---- 1. builder ----
FROM node:20-alpine AS builder
WORKDIR /repo
# openssl: Prisma engine (db:generate). Web tsc, AppRouter tipini apps/api/src'den
# RELATIVE import ettiği için (lib/trpc.ts → '../../../api/src/trpc/app-router'),
# build sırasında api + db KAYNAĞI + generated @prisma/client + built @airmed/db şart;
# yoksa tRPC tipleri çözülmez ("Property X does not exist on type 'useContext'...").
RUN apk add --no-cache openssl
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/api/package.json ./apps/api/
COPY apps/admin/package.json ./apps/admin/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/db/package.json ./packages/db/
COPY packages/observability/package.json ./packages/observability/
RUN CI=true npm ci --workspaces --include-workspace-root --ignore-scripts
COPY packages/contracts/ ./packages/contracts/
COPY packages/db/ ./packages/db/
COPY packages/observability/ ./packages/observability/
COPY apps/api/ ./apps/api/
COPY apps/web/ ./apps/web/
# Bayat incremental tsc state'i temizle (yoksa skip-emit → dist eksik), sonra contracts→db→web.
RUN find . -name '*.tsbuildinfo' -delete \
 && npm run db:generate \
 && npm run build --workspace=@airmed/contracts \
 && npm run build --workspace=@airmed/db \
 && npm run build --workspace=@airmed/observability \
 && npm run build --workspace=@airmed/web

# ---- 2. runtime ----
FROM nginx:1.31-alpine AS runtime
# SPA için fallback: bilinmeyen path'leri index.html'a yönlendir.
RUN rm -rf /usr/share/nginx/html/* \
 && rm /etc/nginx/conf.d/default.conf
COPY --from=builder /repo/apps/web/dist /usr/share/nginx/html
COPY <<'NGINX' /etc/nginx/conf.d/default.conf
server {
  listen 80;
  server_name _;
  root /usr/share/nginx/html;
  index index.html;
  # Vite fingerprint'li asset'ler immutable cache
  location ~* \.(js|css|woff2?|svg|png|jpg|gif|ico)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
    try_files $uri =404;
  }
  # #1056 — index.html asla cache'lenmez: stale index deploy'da silinmiş
  # hash'li chunk'lara işaret edip beyaz ekran yapar.
  location = /index.html {
    add_header Cache-Control "no-cache";
  }
  # SPA: tüm path'ler index.html'a düşer (React Router)
  location / {
    try_files $uri $uri/ /index.html;
  }
}
NGINX
HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget -q --spider http://127.0.0.1/ || exit 1
EXPOSE 80
