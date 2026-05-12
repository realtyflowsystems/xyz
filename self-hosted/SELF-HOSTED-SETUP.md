# RealtyFlow Systems — Self-Hosted Sovereign Stack
## Ubuntu VPS · Docker · PostgreSQL · n8n · Cal.com · Appsmith · Amazon SES · Telnyx

Complete step-by-step guide. Follow in order. Every command is exact and ready to paste.

**Total setup time:** ~3 hours  
**Monthly cost:** ~$20–30 (VPS + SES + Telnyx)  
**What this replaces:** Make.com + Cal.com + GoHighLevel + Twilio + Zapier

---

## Architecture Overview

```
Internet
    │
    ▼
[Nginx Proxy Manager]  ← handles SSL for all subdomains
    │
    ├── book.realtyflow.xyz   → Cal.com    (booking)
    ├── flows.realtyflow.xyz  → n8n        (automations)
    └── crm.realtyflow.xyz    → Appsmith   (CRM dashboard)
    │
    ▼
[PostgreSQL]  ← shared database (n8n + Cal.com use separate DBs)

[Amazon SES]  ← all outbound email
[Telnyx]      ← SMS reminders
```

---

## Step 0 — Get a VPS

**Recommended: Hetzner Cloud** (~$10/month, better value than DigitalOcean)
- hetzner.com/cloud → Create Server
- Location: **Ashburn, VA** (US East)
- Image: **Ubuntu 22.04**
- Type: **CX31** (2 vCPU, 8GB RAM, 80GB SSD) — minimum for this stack
- SSH Key: add yours, or use password auth
- Name: `rfs-server`

After creation, note your **server IP address**.

---

## Step 1 — DNS (do this first, propagation takes ~10 min)

In GoDaddy DNS for `realtyflow.xyz`, add 3 A records:

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | `book` | `YOUR_VPS_IP` | 600 |
| A | `flows` | `YOUR_VPS_IP` | 600 |
| A | `crm` | `YOUR_VPS_IP` | 600 |

Replace `YOUR_VPS_IP` with your actual server IP.

---

## Step 2 — Initial Server Setup

SSH into your server:
```bash
ssh root@YOUR_VPS_IP
```

### 2.1 Update the system
```bash
apt update && apt upgrade -y
```

### 2.2 Create a non-root user
```bash
adduser rfs
usermod -aG sudo rfs
```
Set a strong password when prompted.

### 2.3 Copy SSH access to new user
```bash
rsync --archive --chown=rfs:rfs ~/.ssh /home/rfs
```

### 2.4 Harden SSH (disable root login)
```bash
sed -i 's/PermitRootLogin yes/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart sshd
```

### 2.5 Configure firewall
```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 81/tcp   # Nginx Proxy Manager admin (lock this down after setup)
ufw enable
```
Type `y` when prompted.

### 2.6 Switch to your new user for everything from here
```bash
su - rfs
```

---

## Step 3 — Install Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker rfs
newgrp docker
```

Verify:
```bash
docker --version
docker compose version
```

---

## Step 4 — Create Project Structure

```bash
mkdir -p /opt/rfs/{postgres,n8n,calcom,appsmith,nginx}
cd /opt/rfs
```

---

## Step 5 — Create the .env File

```bash
nano /opt/rfs/.env
```

Paste this and fill in every value marked `CHANGE_ME`:

```env
# ── PostgreSQL ────────────────────────────────────────────────
POSTGRES_USER=rfsadmin
POSTGRES_PASSWORD=CHANGE_ME_strong_password_here
POSTGRES_DB=rfs

# n8n gets its own database
N8N_DB=n8n
N8N_DB_USER=n8n_user
N8N_DB_PASSWORD=CHANGE_ME_another_strong_password

# Cal.com gets its own database
CALCOM_DB=calcom
CALCOM_DB_USER=calcom_user
CALCOM_DB_PASSWORD=CHANGE_ME_another_strong_password

# ── n8n ──────────────────────────────────────────────────────
N8N_HOST=flows.realtyflow.xyz
N8N_BASIC_AUTH_USER=admin
N8N_BASIC_AUTH_PASSWORD=CHANGE_ME_n8n_password
N8N_ENCRYPTION_KEY=CHANGE_ME_32_char_random_string_here

# ── Cal.com ───────────────────────────────────────────────────
CALCOM_NEXTAUTH_SECRET=CHANGE_ME_run_openssl_rand_base64_32
CALCOM_ENCRYPTION_KEY=CHANGE_ME_run_openssl_rand_hex_16
CALCOM_URL=https://book.realtyflow.xyz

# ── Amazon SES (SMTP) ─────────────────────────────────────────
SES_HOST=email-smtp.us-east-1.amazonaws.com
SES_PORT=587
SES_USER=CHANGE_ME_ses_smtp_username
SES_PASSWORD=CHANGE_ME_ses_smtp_password
EMAIL_FROM=erics@realtyflow.xyz

# ── Telnyx ───────────────────────────────────────────────────
TELNYX_API_KEY=CHANGE_ME
TELNYX_FROM_NUMBER=+1XXXXXXXXXX
```

Save with `Ctrl+O`, `Enter`, `Ctrl+X`.

**Generate the random secrets:**
```bash
openssl rand -base64 32   # use for CALCOM_NEXTAUTH_SECRET and N8N_ENCRYPTION_KEY
openssl rand -hex 16      # use for CALCOM_ENCRYPTION_KEY
```
Run each twice and paste the outputs into the `.env` file.

---

## Step 6 — Create docker-compose.yml

```bash
nano /opt/rfs/docker-compose.yml
```

Paste the contents of `self-hosted/docker-compose.yml` from this repo.

Save with `Ctrl+O`, `Enter`, `Ctrl+X`.

---

## Step 7 — Start PostgreSQL First

```bash
cd /opt/rfs
docker compose up -d postgres
```

Wait 15 seconds, then create the separate databases:
```bash
docker compose exec postgres psql -U rfsadmin -d rfs -c "
  CREATE USER n8n_user WITH PASSWORD 'SAME_PASSWORD_AS_N8N_DB_PASSWORD_IN_ENV';
  CREATE DATABASE n8n OWNER n8n_user;
  CREATE USER calcom_user WITH PASSWORD 'SAME_PASSWORD_AS_CALCOM_DB_PASSWORD_IN_ENV';
  CREATE DATABASE calcom OWNER calcom_user;
"
```

Replace both passwords with the actual values you set in `.env`.

---

## Step 8 — Start Nginx Proxy Manager

```bash
docker compose up -d nginx-proxy-manager
```

Visit `http://YOUR_VPS_IP:81` in your browser.

**Default login:**
- Email: `admin@example.com`
- Password: `changeme`

**Immediately change these** → click your name (top right) → Change Password.

---

## Step 9 — Start n8n

```bash
docker compose up -d n8n
```

Wait 30 seconds. In Nginx Proxy Manager:
1. **Hosts** → **Proxy Hosts** → **Add Proxy Host**
2. Domain: `flows.realtyflow.xyz`
3. Forward Hostname: `n8n` | Port: `5678`
4. Toggle ON: **Block Common Exploits**, **Websockets Support**
5. **SSL tab** → Request new SSL cert → Force SSL → toggle both on → Save

Visit `https://flows.realtyflow.xyz` — you should see n8n login.

---

## Step 10 — Start Cal.com

```bash
docker compose up -d calcom
```

Cal.com takes 2–3 minutes to start (it runs database migrations on first boot).

Check it's ready:
```bash
docker compose logs calcom --follow
```
Wait until you see `ready - started server`. Press `Ctrl+C`.

In Nginx Proxy Manager, add another proxy host:
1. Domain: `book.realtyflow.xyz`
2. Forward Hostname: `calcom` | Port: `3000`
3. SSL tab → Request new SSL cert → Force SSL → Save

Visit `https://book.realtyflow.xyz` → complete the Cal.com setup wizard.

---

## Step 11 — Start Appsmith

```bash
docker compose up -d appsmith
```

Appsmith takes 3–5 minutes on first boot.

In Nginx Proxy Manager:
1. Domain: `crm.realtyflow.xyz`
2. Forward Hostname: `appsmith` | Port: `80`
3. SSL tab → Request new SSL cert → Force SSL → Save

Visit `https://crm.realtyflow.xyz` → create your admin account.

---

## Step 12 — Amazon SES Setup

### 12.1 Verify your domain
1. AWS Console → SES → **Verified Identities** → **Create Identity**
2. Identity type: **Domain** → enter `realtyflow.xyz`
3. AWS gives you DKIM records → add them to GoDaddy DNS
4. Also verify `erics@realtyflow.xyz` as a sending address

### 12.2 Get SMTP credentials
1. SES → **SMTP Settings** → **Create SMTP Credentials**
2. IAM user name: `rfs-ses-smtp`
3. Download the credentials CSV — this gives you `SES_USER` and `SES_PASSWORD`
4. Update your `.env` file with these values

### 12.3 Request production access
By default SES is in sandbox mode (can only email verified addresses).
- SES → **Account Dashboard** → **Request Production Access**
- Use case: transactional emails for booking confirmations and client onboarding
- Approval takes 24–48 hours

---

## Step 13 — Telnyx Setup

1. **telnyx.com** → sign up → verify account
2. **Numbers** → Search → buy a Boston area number (617/781/508)
3. **API Keys** → Create key → copy as `TELNYX_API_KEY`
4. **Messaging** → Create a messaging profile → note the profile ID
5. Update `.env` with `TELNYX_API_KEY` and `TELNYX_FROM_NUMBER`

After updating `.env`, restart n8n to pick up the new values:
```bash
cd /opt/rfs
docker compose up -d --force-recreate n8n
```

---

## Step 14 — Connect Everything in n8n

### 14.1 Booking confirmation workflow
In n8n (`https://flows.realtyflow.xyz`):
1. **New Workflow** → name it "Booking Confirmation"
2. **Trigger:** Webhook node → copy the webhook URL
3. In Cal.com: Settings → Webhooks → add the n8n webhook URL → event: `BOOKING_CREATED`
4. Add **Send Email** node (AWS SES credentials) → confirmation template
5. Add **HTTP Request** node → Telnyx API → SMS confirmation
6. Add **Postgres** node → insert lead into your `leads` table
7. Activate the workflow

### 14.2 SMS reminder workflow
1. **New Workflow** → "24h Reminder"
2. **Trigger:** Cron node → every day at 8am
3. **Postgres** node → query bookings where `slot_time` is tomorrow
4. Loop over results → **HTTP Request** → Telnyx SMS for each

### 14.3 Follow-up sequences
1. **New Workflow** → "Post-Audit Follow-up"
2. **Trigger:** Webhook (triggered from booking confirmation workflow on status change)
3. Wait node → 48 hours
4. Send Email node → follow-up template
5. Wait node → 48 more hours
6. Send Email node → second follow-up

---

## Step 15 — Appsmith CRM

1. Go to `https://crm.realtyflow.xyz`
2. **New Application** → name "RFS Command Center"
3. **Datasources** → **PostgreSQL** → connect:
   - Host: `postgres`
   - Port: `5432`
   - Database: `rfs`
   - User/Password: from your `.env`
4. Build pages:
   - **Pipeline** — table/kanban from `leads` table
   - **Activity** — table from `activity_log`
   - **Revenue** — chart from `payments`

Appsmith has drag-and-drop UI builder — no coding required for basic views.

---

## Step 16 — Backups

Set up daily automated backups:

```bash
nano /opt/rfs/backup.sh
```

```bash
#!/bin/bash
BACKUP_DIR=/opt/rfs/backups
DATE=$(date +%Y-%m-%d)
mkdir -p $BACKUP_DIR

# Dump all databases
docker exec rfs-postgres pg_dumpall -U rfsadmin > $BACKUP_DIR/postgres-$DATE.sql

# Keep only last 14 days
find $BACKUP_DIR -name "*.sql" -mtime +14 -delete

echo "Backup complete: $DATE"
```

```bash
chmod +x /opt/rfs/backup.sh

# Schedule daily at 2am
(crontab -l 2>/dev/null; echo "0 2 * * * /opt/rfs/backup.sh") | crontab -
```

---

## Step 17 — Lock Down After Setup

Once everything is working, close the NPM admin port:
```bash
sudo ufw delete allow 81/tcp
sudo ufw reload
```

Access NPM admin only via SSH tunnel going forward:
```bash
ssh -L 8181:localhost:81 rfs@YOUR_VPS_IP
```
Then visit `http://localhost:8181`.

---

## Monthly Cost Breakdown

| Service | Cost |
|---|---|
| Hetzner CX31 VPS | ~$10/mo |
| Amazon SES (1K emails) | ~$0.10/mo |
| Telnyx number + 100 SMS | ~$3/mo |
| Domain (GoDaddy) | already owned |
| **Total** | **~$13/mo** |

vs. Make + GHL + Cal + Twilio = **$200–400/mo**

---

## Troubleshooting

**Cal.com won't start:**
```bash
docker compose logs calcom --tail=50
```
Usually a missing env var. Check `DATABASE_URL` format.

**SSL cert fails:**
- Make sure DNS A records have propagated: `nslookup book.realtyflow.xyz`
- Must return your VPS IP before SSL will work

**n8n workflows not firing:**
- Check webhook URL is exactly what Cal.com is sending to
- n8n logs: `docker compose logs n8n --tail=50`

**Postgres connection refused:**
```bash
docker compose ps    # check postgres is running
docker compose logs postgres --tail=20
```

**Full restart:**
```bash
cd /opt/rfs
docker compose down
docker compose up -d
```
