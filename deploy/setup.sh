#!/usr/bin/env bash
# Run on the Ubuntu server as root (or with sudo).
# Usage:
#   cd /var/www/qalaqobana && sudo bash deploy/setup.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/qalaqobana}"
APP_USER="${APP_USER:-www-data}"
DOMAIN="${DOMAIN:-qalaqobana.g1orga.dev}"
PORT="${PORT:-5017}"
DB_NAME="${DB_NAME:-qalaqobana}"
DB_USER="${DB_USER:-qalaqobana}"
DB_PASS="${DB_PASS:-}"

echo "==> Installing system packages"
apt-get update -y
apt-get install -y python3 python3-venv python3-pip nginx postgresql postgresql-contrib

echo "==> App directory: $APP_DIR"
mkdir -p "$APP_DIR/data"
cd "$APP_DIR"

if [[ ! -f run.py ]]; then
  echo "ERROR: run.py not found in $APP_DIR — clone/copy the project here first."
  exit 1
fi

echo "==> PostgreSQL role + database"
systemctl enable --now postgresql
if [[ -z "$DB_PASS" ]]; then
  DB_PASS=$(python3 -c 'import secrets; print(secrets.token_urlsafe(24))')
  echo "Generated DB password (saved into .env)"
fi
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}';
  ELSE
    ALTER ROLE ${DB_USER} WITH PASSWORD '${DB_PASS}';
  END IF;
END
\$\$;
SELECT 'CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${DB_NAME}')\gexec
GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};
SQL

# Postgres 15+ needs schema grants
sudo -u postgres psql -d "$DB_NAME" -v ON_ERROR_STOP=1 <<SQL
GRANT ALL ON SCHEMA public TO ${DB_USER};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ${DB_USER};
SQL

DATABASE_URL="postgresql+psycopg://${DB_USER}:${DB_PASS}@127.0.0.1:5432/${DB_NAME}"

echo "==> Python venv + deps"
python3 -m venv .venv
# shellcheck disable=SC1091
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

echo "==> .env"
if [[ ! -f .env ]]; then
  cp .env.example .env
fi
SECRET=$(python3 -c 'import secrets; print(secrets.token_hex(32))')
# upsert keys in .env
set_env () {
  local key="$1" val="$2"
  if grep -q "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=${val}|" .env
  else
    echo "${key}=${val}" >> .env
  fi
}
set_env SECRET_KEY "$SECRET"
set_env PORT "$PORT"
set_env HOST "127.0.0.1"
set_env BEHIND_PROXY "1"
set_env CORS_ORIGINS "https://${DOMAIN}"
set_env DATABASE_URL "$DATABASE_URL"
# ensure sqlite fallback is off
sed -i '/^ALLOW_SQLITE=/d' .env || true

if [[ ! -f data/qalaqobana_words.csv && ! -f qalaqobana_words.csv ]]; then
  echo "WARNING: data/qalaqobana_words.csv missing — upload it then re-import."
fi

echo "==> Permissions for $APP_USER"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

echo "==> Import lexicon into PostgreSQL (if CSV present)"
sudo -u "$APP_USER" bash -lc "cd '$APP_DIR' && set -a && source .env && set +a && .venv/bin/python -m app.game.lexicon" || true

echo "==> systemd unit"
cp deploy/qalaqobana.service /etc/systemd/system/qalaqobana.service
systemctl daemon-reload
systemctl enable qalaqobana
systemctl restart qalaqobana
systemctl --no-pager --full status qalaqobana || true

echo "==> nginx site"
cp deploy/nginx-qalaqobana.conf /etc/nginx/sites-available/qalaqobana
ln -sf /etc/nginx/sites-available/qalaqobana /etc/nginx/sites-enabled/qalaqobana
nginx -t
systemctl reload nginx

echo ""
echo "=============================================="
echo " App:      127.0.0.1:$PORT"
echo " Public:   https://$DOMAIN"
echo " Postgres: $DB_NAME @ 127.0.0.1:5432 (user $DB_USER)"
echo " CSV seed: $APP_DIR/data/qalaqobana_words.csv"
echo ""
echo " Re-import words after uploading CSV:"
echo "   cd $APP_DIR && sudo -u $APP_USER .venv/bin/python -m app.game.lexicon"
echo "=============================================="
