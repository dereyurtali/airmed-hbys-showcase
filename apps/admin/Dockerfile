# A15 — Production admin image (DNA platform admin UI, nginx static serve).
# apps/web Dockerfile ile aynı pattern; daha az route, daha küçük bundle.

# ---- 1. builder ----
FROM node:20-alpine AS builder
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/admin/package.json ./apps/admin/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
# packages/contracts manifest: npm ci --workspaces lockfile'daki @airmed/contracts
# workspace'ini bekler (#936); yoksa `npm ci` "missing workspace" ile patlar.
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/db/package.json ./packages/db/
COPY packages/observability/package.json ./packages/observability/
RUN CI=true npm ci --workspaces --include-workspace-root --ignore-scripts
# admin `@airmed/observability` import eder (sentry.ts) → Bundler resolution
# exports.import → src'e çözülür; KAYNAĞI olmadan tsc -b "Cannot find module" verir.
# (Eski Dockerfile yalnız package.json'ı kopyalıyordu → admin image build KIRIKTI.)
COPY packages/observability/ ./packages/observability/
COPY tsconfig.base.json ./
COPY apps/admin/ ./apps/admin/
RUN find . -name '*.tsbuildinfo' -delete \
 && npm run build --workspace=@airmed/observability \
 && npm run build --workspace=@airmed/admin

# ---- 2. runtime ----
FROM nginx:1.31-alpine AS runtime
RUN rm -rf /usr/share/nginx/html/* \
 && rm /etc/nginx/conf.d/default.conf
COPY --from=builder /repo/apps/admin/dist /usr/share/nginx/html
COPY <<'NGINX' /etc/nginx/conf.d/default.conf
server {
  listen 80;
  server_name _;
  root /usr/share/nginx/html;
  index index.html;
  location ~* \.(js|css|woff2?|svg|png|jpg|gif|ico)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
    try_files $uri =404;
  }
  location / {
    try_files $uri $uri/ /index.html;
  }
}
NGINX
HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget -q --spider http://127.0.0.1/ || exit 1
EXPOSE 80
