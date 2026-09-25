# Deploy Qalaqobana → https://qalaqobana.g1orga.dev

App listens on **127.0.0.1:5017** (unused local port). Nginx on 80/443 + Cloudflare handle the public side.

## 1. Cloudflare DNS

In Cloudflare → **g1orga.dev** → DNS:

| Type | Name | Content | Proxy |
|------|------|---------|-------|
| A | `qalaqobana` | your Ubuntu server IPv4 | Proxied (orange) |

SSL/TLS mode:

- **Flexible** — works immediately with the included HTTP nginx config
- **Full (strict)** — better; run certbot on the server after DNS is live

Network → ensure **WebSockets** is On (default).

## 2. Copy the project to the server

```bash
# from your PC (example)
scp -r C:\Users\user\Qalaqobana user@YOUR_SERVER_IP:/tmp/qalaqobana-src

# on the server
sudo mkdir -p /var/www/qalaqobana
sudo rsync -a /tmp/qalaqobana-src/ /var/www/qalaqobana/
# keep the word CSV + you can omit .venv
sudo rm -rf /var/www/qalaqobana/.venv
```

Or `git clone` into `/var/www/qalaqobana` if the repo is on GitHub.

## 3. One-shot install

```bash
cd /var/www/qalaqobana
sudo bash deploy/setup.sh
```

This installs nginx, creates a venv, writes `.env`, enables **systemd** `qalaqobana`, and configures nginx for `qalaqobana.g1orga.dev`.

## 4. (Optional) HTTPS on origin — Full (strict)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d qalaqobana.g1orga.dev
```

Then set Cloudflare SSL/TLS to **Full (strict)**.

## 5. Checks

```bash
curl -I http://127.0.0.1:5017/
sudo journalctl -u qalaqobana -f
sudo nginx -t && sudo systemctl reload nginx
```

Open https://qalaqobana.g1orga.dev

## Update later

```bash
cd /var/www/qalaqobana
# pull / rsync new files
sudo -u www-data /var/www/qalaqobana/.venv/bin/pip install -r requirements.txt
sudo systemctl restart qalaqobana
```

## Ports

| What | Port |
|------|------|
| Public HTTP/HTTPS (nginx / Cloudflare) | 80 / 443 |
| Qalaqobana app (localhost only) | **5017** |
