#!/bin/sh
# A15 PR 2 — Let's Encrypt wildcard certificate bootstrap.
#
# Wildcard SSL (*.hbys.dnasoft.co + admin.dnasoft.co) için
# DNS-01 challenge gerekli (HTTP-01 wildcard'a izin vermiyor). DNS sağlayıcı
# Cloudflare ise certbot-dns-cloudflare plugin; başka sağlayıcı için
# `--manual` mode + manuel TXT kayıt.
#
# Bu script ilk bootstrap; cron yenilemeyi `certbot renew` halleder (90 günlük
# cert'leri 30 gün önce yeniler).
#
# Kullanım (dev ortamından yapılmaz; production sunucuda):
#   chmod +x docker/nginx/init-letsencrypt.sh
#   sudo ./docker/nginx/init-letsencrypt.sh

set -e

DOMAIN_BASE="${DOMAIN_BASE:-dnasoft.co}"
EMAIL="${LETSENCRYPT_EMAIL:?LETSENCRYPT_EMAIL required (e.g., admin@$DOMAIN_BASE)}"
DATA_PATH="${DATA_PATH:-./docker/nginx/certbot}"

if [ -d "$DATA_PATH/conf/live/$DOMAIN_BASE" ]; then
  echo "✓ Certificate already exists for $DOMAIN_BASE"
  echo "  Run 'certbot renew' (cron) to refresh."
  exit 0
fi

echo "→ Creating dummy certificate for $DOMAIN_BASE (nginx boot için)..."
mkdir -p "$DATA_PATH/conf/live/$DOMAIN_BASE"
docker run --rm \
  -v "$(pwd)/$DATA_PATH/conf:/etc/letsencrypt" \
  -v "$(pwd)/$DATA_PATH/www:/var/www/certbot" \
  certbot/certbot:latest \
  certonly --standalone -d "$DOMAIN_BASE" --register-unsafely-without-email \
  --rsa-key-size 2048 --agree-tos --force-renewal \
  --staging || true

echo "→ Starting nginx with dummy cert..."
docker compose -f docker-compose.prod.yml up -d nginx
sleep 5

echo "→ Requesting real wildcard cert via DNS-01 (manual mode)..."
echo "  → Certbot will prompt you to add a TXT record:"
echo "    _acme-challenge.$DOMAIN_BASE  →  <value>"
echo "    _acme-challenge.hbys.$DOMAIN_BASE  →  <value>"
echo "  Edit DNS, wait for propagation, then press Enter."
echo ""

docker run --rm -it \
  -v "$(pwd)/$DATA_PATH/conf:/etc/letsencrypt" \
  -v "$(pwd)/$DATA_PATH/www:/var/www/certbot" \
  certbot/certbot:latest \
  certonly --manual --preferred-challenges dns \
  -d "$DOMAIN_BASE" \
  -d "*.$DOMAIN_BASE" \
  -d "*.hbys.$DOMAIN_BASE" \
  --email "$EMAIL" --agree-tos --no-eff-email \
  --force-renewal

echo "→ Reloading nginx with real cert..."
docker compose -f docker-compose.prod.yml exec nginx nginx -s reload

echo ""
echo "✓ Wildcard cert installed."
echo "→ Otomatik yenileme için crontab (sunucuda root):"
echo "   0 12 * * * docker compose -f /opt/airmed/docker-compose.prod.yml run --rm certbot renew --quiet && docker compose -f /opt/airmed/docker-compose.prod.yml exec nginx nginx -s reload"
