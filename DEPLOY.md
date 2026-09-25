# Deploy Qalaqobana → https://qalaqobana.g1orga.dev

App on **127.0.0.1:5017**. Words live in **PostgreSQL** (not a `.db` file). CSV at `data/qalaqobana_words.csv` is only the import seed.

## 1. Cloudflare DNS

| Type | Name | Content | Proxy |
|------|------|---------|-------|
| A | `qalaqobana` | your Ubuntu server IPv4 | Proxied |

SSL/TLS: **Flexible** first, or **Full (strict)** after certbot. WebSockets: On.

## 2. Get the code on the server

```bash
sudo mkdir -p /var/www/qalaqobana
sudo git clone https://github.com/G10rga/Qalaqobana.git /var/www/qalaqobana
# or: git pull inside that folder later
```

Put the word list here (git or upload):

```text
/var/www/qalaqobana/data/qalaqobana_words.csv
```

## 3. Install (Postgres + nginx + systemd)

```bash
cd /var/www/qalaqobana
sudo bash deploy/setup.sh
```

Creates DB user/database, writes `DATABASE_URL` into `.env`, imports the CSV into Postgres, starts the app.

### Re-import CSV later

```bash
cd /var/www/qalaqobana
# after updating data/qalaqobana_words.csv
sudo -u www-data .venv/bin/python -m app.game.lexicon
sudo systemctl restart qalaqobana
```

## 4. Optional origin HTTPS

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d qalaqobana.g1orga.dev
```

Cloudflare SSL → **Full (strict)**.

## Ports

| What | Port |
|------|------|
| HTTP/HTTPS (nginx / Cloudflare) | 80 / 443 |
| Qalaqobana app | **5017** (localhost) |
| PostgreSQL | **5432** (localhost) |

## Local Windows (optional)

Install Postgres locally, then in `.env`:

```env
DATABASE_URL=postgresql+psycopg://qalaqobana:PASSWORD@127.0.0.1:5432/qalaqobana
```

Do **not** set `ALLOW_SQLITE=1` on the server.
