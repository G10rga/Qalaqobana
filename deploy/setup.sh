#!/usr/bin/env bash
# Run on the Ubuntu server as root (or with sudo).
# Usage:
#   cd /var/www/qalaqobana && sudo bash deploy/setup.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/qalaqobana}"
APP_USER="${APP_USER:-www-data}"
DOMAIN="${DOMAIN:-qalaqobana.g1orga.dev}"
PORT="${PORT:-5017}"

echo "==> Installing system packages"
apt-get update -y
apt-get install -y python3 python3-venv python3-pip nginx

echo "==> App directory: $APP_DIR"
mkdir -p "$APP_DIR"
cd "$APP_DIR"

if [[ ! -f run.py ]]; then
  echo "ERROR: run.py not found in $APP_DIR — copy/clone the project here first."
  exit 1
fi

echo "==> Python venv + deps"
python3 -m venv .venv
# shellcheck disable=SC1091
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

echo "==> .env"
if [[ ! -f .env ]]; then
  cp .env.example .env
  SECRET=$(python3 -c 'import secrets; print(secrets.token_hex(32))')
  sed -i "s/^SECRET_KEY=.*/SECRET_KEY=$SECRET/" .env
  sed -i "s/^PORT=.*/PORT=$PORT/" .env
  sed -i "s|^CORS_ORIGINS=.*|CORS_ORIGINS=https://$DOMAIN|" .env
  echo "BEHIND_PROXY=1" >> .env
  echo "HOST=127.0.0.1" >> .env
  echo "Created .env with a random SECRET_KEY"
else
  echo ".env already exists — leaving it alone"
fi

# Ensure lexicon DB can be built
mkdir -p data
if [[ ! -f qalaqobana_words.csv ]]; then
  echo "WARNING: qalaqobana_words.csv missing — scoring lexicon will be empty until you upload it."
fi

echo "==> Permissions for $APP_USER"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

echo "==> systemd unit"
cp deploy/qalaqobana.service /etc/systemd/system/qalaqobana.service
systemctl daemon-reload
systemctl enable qalaqobana
systemctl restart qalaqobana
systemctl --no-pager --full status qalaqobana || true

echo "==> nginx site"
cp deploy/nginx-qalaqobana.conf /etc/nginx/sites-available/qalaqobana
ln -sf /etc/nginx/sites-available/qalaqobana /etc/nginx/sites-enabled/qalaqobana
# Remove default site conflict if present (optional)
nginx -t
systemctl reload nginx

echo ""
echo "=============================================="
echo " App bound to 127.0.0.1:$PORT"
echo " Public URL: https://$DOMAIN"
echo ""
echo " Cloudflare DNS (dashboard):"
echo "   Type: A   (or CNAME)"
echo "   Name: qalaqobana"
echo "   Content: YOUR_SERVER_IP  (or root domain)"
echo "   Proxy: ON (orange cloud)"
echo ""
echo " Cloudflare SSL/TLS:"
echo "   Mode: Flexible  (works with this HTTP nginx)"
echo "   OR Full (strict) after:"
echo "     sudo apt install certbot python3-certbot-nginx"
echo "     sudo certbot --nginx -d $DOMAIN"
echo "=============================================="
echo " Useful:"
echo "   sudo journalctl -u qalaqobana -f"
echo "   sudo systemctl restart qalaqobana"
echo "=============================================="
