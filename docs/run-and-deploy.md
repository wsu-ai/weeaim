# Running WEEAIM locally and in production

WEEAIM has three parts:

| Part | Technology | Local address |
|---|---|---|
| Database | PostgreSQL 16 + pgvector (Docker) | `localhost:5432` |
| Backend API | Python 3.14, FastAPI (uvicorn) | `http://localhost:8000` |
| Frontend | Next.js 16 (Node 24, pnpm) | `http://localhost:3000` |

All configuration lives in **one file, `.env` in the repository root**, which
is git-ignored. `.env.example` lists every setting. The frontend has its own
small `frontend/.env.local`.

---

## Part 1 — Run it locally (Windows)

### One-time setup

Install the tools:
- **Docker Desktop**. In *Settings → General*, tick *Start Docker Desktop when you sign in*.
- **Python 3.14**.
- **Node.js 24**. Then run `npm install -g pnpm` (the project uses pnpm 12).
- **Git**.

In PowerShell, from the repository root (`D:\AI\WEEAIM`):

```powershell
# 1. Settings: copy the example and fill it in (see "Settings" below)
Copy-Item .env.example .env
notepad .env

# 2. Database (first run downloads the images)
docker compose up -d

# 3. Backend
cd backend
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.venv\Scripts\python.exe -m alembic upgrade head          # creates/updates tables
.venv\Scripts\python.exe -m scripts.invite_user --email you@example.com --org-slug woosong --org-name "Woosong University" --role owner

# 4. Frontend
cd ..\frontend
Copy-Item .env.local.example .env.local                     # NEXT_PUBLIC_API_URL=http://localhost:8000
pnpm install
```

#### Settings to fill in `.env` for local use

| Setting | Local value |
|---|---|
| `POSTGRES_PASSWORD`, `APP_DB_PASSWORD`, `SERVICE_DB_PASSWORD` | Any strong passwords. Use the same values inside the three `*_DATABASE_URL` lines |
| `OPENAI_API_KEY` | Your OpenAI key (needed for AI interpretation and research) |
| `GOOGLE_CLIENT_ID` | Optional. See `docs/google-sign-in.md`; without it, use dev sign-in |
| `SESSION_SECRET` | Output of `python -c "import secrets; print(secrets.token_urlsafe(48))"` |
| `EMAIL_BACKEND` | `console` (codes are printed in the backend window), or `smtp` with the `SMTP_*` settings |

Leave `ENVIRONMENT` unset. It defaults to `development`, which enables the dev
email sign-in for `dev@weeaim.local` (create that user with
`python -m scripts.seed_dev_org`).

### Every time you work on it

Open **three terminals** in VS Code (`Ctrl+Shift+``), one per row:

| # | Folder | Command | Leave it running |
|---|---|---|---|
| 1 | repo root | `docker compose up -d` (once, then the terminal is free) | — |
| 2 | `backend` | `.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000` | yes |
| 3 | `frontend` | `pnpm dev` | yes |

Then open **http://localhost:3000**.

- The frontend must be on port **3000**. The backend only accepts the browser
  from there. If `pnpm dev` says 3001, something else holds 3000; stop it
  first.
- After editing `.env`, restart terminal 2. `--reload` doesn't re-read
  `.env`.
- If the app says *"temporarily unavailable"*, Docker Desktop or the database
  isn't running. Run `docker compose up -d`.

### Tests and checks (run before committing)

```powershell
cd backend;  .venv\Scripts\python.exe -m pytest           # uses a separate *_test database
cd ..\frontend;  pnpm lint;  pnpm test;  pnpm build
```

### Everyday admin tasks (from `backend`)

| Task | Command |
|---|---|
| Invite a user | `.venv\Scripts\python.exe -m scripts.invite_user --email x@y.com --org-slug woosong` |
| List / approve sign-ups | `... -m scripts.manage_signups list`, then `approve --email ... --org-slug woosong` (or use **Admin** in the app) |
| Test email settings | `... -m scripts.send_test_email --to you@example.com` |
| Apply new migrations after pulling | `... -m alembic upgrade head` |

---

## Part 2 — Production (a real website)

The cloud provider isn't decided yet (see `docs/architecture.md`). These steps
use the simplest dependable setup, which works on any provider (AWS, Azure,
GCP, Naver Cloud and others):

> **One Linux server (VM) + Docker for the database + the backend and frontend
> as services + Caddy in front for HTTPS.**

```
                    https://weeaim.example.edu
                               │
                        ┌──────▼──────┐   automatic HTTPS (Let's Encrypt)
                        │    Caddy    │
                        └──┬───────┬──┘
              /api/* , /health    everything else
             ┌─────────▼───┐   ┌──▼──────────┐
             │ Backend     │   │ Frontend    │
             │ uvicorn:8000│   │ next:3000   │
             └──────┬──────┘   └─────────────┘
             ┌──────▼──────────────┐
             │ PostgreSQL+pgvector │  (Docker, or a managed database)
             └─────────────────────┘
```

**Why one domain:** the sign-in cookie is `SameSite=Lax` and `Secure`, and the
backend doesn't enable cross-origin requests in production. So the website and
the API must be served from the **same address**, with `/api/...` going to the
backend. Caddy does that routing.

### 0. Prerequisites and decisions

- [ ] **A server.** Ubuntu 24.04 LTS, 2 vCPU / 4 GB RAM / 40 GB disk is enough for a pilot. Consider a Korean region (data residency).
- [ ] **A domain name** (for example `weeaim.example.edu`) with a DNS **A record** pointing to the server's public IP. Ask Woosong IT for a subdomain.
- [ ] **An outgoing email account** (Google Workspace, SendGrid, Amazon SES…). See `docs/sign-up-and-approval.md`.
- [ ] **An OpenAI API key** for production, ideally separate from the development key.
- [ ] **A private git repository** (GitHub, GitLab or similar) to deploy from. The project currently has no remote: `git remote add origin <url>`, then `git push -u origin --all`.
- [ ] **Legal review** of the Terms of Use and privacy text shown at sign-up (`docs/sign-up-and-approval.md`).

### 1. Prepare the server (once)

Connect with SSH, then:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl ufw debian-keyring debian-archive-keyring apt-transport-https

# Firewall: only SSH and web traffic from outside
sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw enable

# Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER      # log out and back in afterwards

# Python 3.14 (deadsnakes PPA)
sudo add-apt-repository -y ppa:deadsnakes/ppa
sudo apt install -y python3.14 python3.14-venv

# Node 24 + pnpm
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs && sudo npm install -g pnpm

# Caddy (HTTPS reverse proxy)
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy

# An app user and folder
sudo useradd -m -s /bin/bash weeaim
sudo mkdir -p /srv/weeaim && sudo chown weeaim:weeaim /srv/weeaim
```

### 2. Get the code and configure it

```bash
sudo -iu weeaim
git clone <your-repo-url> /srv/weeaim && cd /srv/weeaim
git checkout master            # or the branch you release from
cp .env.example .env && nano .env
chmod 600 .env                 # only the app user can read secrets
```

**Production `.env`.** Every value must be new; never reuse development secrets.

| Setting | Production value |
|---|---|
| `ENVIRONMENT` | `production` (turns off dev sign-in and dev headers, makes cookies `Secure`, requires `SESSION_SECRET`) |
| `SESSION_SECRET` | New 48+ character random value. Changing it signs everyone out |
| `POSTGRES_PASSWORD`, `APP_DB_PASSWORD`, `SERVICE_DB_PASSWORD` | New strong passwords, matched in the three `*_DATABASE_URL`s (`@localhost:5432`) |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | Production key; a model that supports web search |
| `GOOGLE_CLIENT_ID` | Same client as development is fine (see step 6) |
| `EMAIL_BACKEND=smtp`, `EMAIL_FROM`, `SMTP_*` | Real email settings; `SIGNUP_NOTIFY_EMAIL` for admin alerts |
| `UPLOAD_STORAGE_DIR` | `/srv/weeaim-data/uploads` (outside the code folder; back it up) |
| `WEB_SEARCH_ALLOWED_DOMAINS` | Optional: restrict AI web research to approved sites |

```bash
sudo mkdir -p /srv/weeaim-data/uploads && sudo chown -R weeaim:weeaim /srv/weeaim-data
```

### 3. Database

Keep the database reachable **only from the server itself**. Add a file
`docker-compose.prod.yml` next to `docker-compose.yml`:

```yaml
services:
  db:
    ports: !override
      - "127.0.0.1:5432:5432"
    restart: unless-stopped
  redis:
    ports: !override
      - "127.0.0.1:6379:6379"
    restart: unless-stopped
```

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

> **Managed database alternative** (Amazon RDS, Azure Database for
> PostgreSQL, Cloud SQL): use PostgreSQL 16 with the **pgvector** extension
> enabled. Point the three `*_DATABASE_URL`s at it. The `DATABASE_URL` user
> needs permission to create roles (`CREATEROLE`), because the first migration
> creates the `venture_app` and `venture_service` roles.

### 4. Backend

```bash
cd /srv/weeaim/backend
python3.14 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m alembic upgrade head
# First administrator (they then sign in and approve others in the app)
.venv/bin/python -m scripts.invite_user --email you@woosong.ac.kr --org-slug woosong \
    --org-name "Woosong University" --role owner
.venv/bin/python -m scripts.send_test_email --to you@woosong.ac.kr   # check email works
exit
```

Run it as a service. Create `/etc/systemd/system/weeaim-api.service`:

```ini
[Unit]
Description=WEEAIM API
After=network.target docker.service

[Service]
User=weeaim
WorkingDirectory=/srv/weeaim/backend
ExecStart=/srv/weeaim/backend/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 2 --proxy-headers --forwarded-allow-ips 127.0.0.1
Restart=always

[Install]
WantedBy=multi-user.target
```

### 5. Frontend

`NEXT_PUBLIC_API_URL` is **built into** the frontend, so set it **before**
building:

```bash
sudo -iu weeaim
cd /srv/weeaim/frontend
echo "NEXT_PUBLIC_API_URL=https://weeaim.example.edu" > .env.local
pnpm install --frozen-lockfile
pnpm build
exit
```

Create `/etc/systemd/system/weeaim-web.service`:

```ini
[Unit]
Description=WEEAIM web
After=network.target

[Service]
User=weeaim
WorkingDirectory=/srv/weeaim/frontend
Environment=NODE_ENV=production PORT=3000 HOSTNAME=127.0.0.1
ExecStart=/usr/bin/pnpm start
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now weeaim-api weeaim-web
systemctl status weeaim-api weeaim-web      # both should say "active (running)"
```

### 6. HTTPS and routing (Caddy)

Replace `/etc/caddy/Caddyfile` with (use your domain):

```caddy
weeaim.example.edu {
    encode gzip

    # API and health check → backend; everything else → website
    handle /api/* {
        reverse_proxy 127.0.0.1:8000
    }
    handle /health {
        reverse_proxy 127.0.0.1:8000
    }
    handle {
        reverse_proxy 127.0.0.1:3000
    }

    request_body {
        max_size 25MB      # document uploads (backend limit is 20 MB)
    }
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "strict-origin-when-cross-origin"
    }
}
```

```bash
sudo systemctl reload caddy      # Caddy obtains the HTTPS certificate automatically
```

Then, in **Google Cloud Console → Google Auth Platform → Clients → your
client**, add `https://weeaim.example.edu` to **Authorized JavaScript
origins**. If the consent screen is **External**, publish the app, or add
users as test users.

### 7. Check it

- [ ] `https://weeaim.example.edu/health` shows `{"status":"ok"}`.
- [ ] The home page loads over HTTPS, with no development sign-in section visible.
- [ ] **Sign in with Google** works for the invited admin, and **Admin** appears in the top bar.
- [ ] Sign up with a second email: the code arrives by email, then approve it under **Admin**.
- [ ] Create an idea, then check Stage 1 research runs and source links open.

### 8. Updating to a new version

```bash
sudo -iu weeaim
cd /srv/weeaim && git pull
cd backend && .venv/bin/pip install -r requirements.txt && .venv/bin/python -m alembic upgrade head
cd ../frontend && pnpm install --frozen-lockfile && pnpm build
exit
sudo systemctl restart weeaim-api weeaim-web
```

Run the tests on your PC **before** pushing (Part 1). Back up the database
before updates that include migrations (step 9).

### 9. Backups and monitoring (do these before inviting real users)

- **Database:** a nightly dump kept off the server. For example, a cron job:
  `docker compose exec -T db pg_dump -U venture_user venture_platform | gzip > /srv/weeaim-data/backup-$(date +%F).sql.gz`,
  then copy it to cloud storage. Test a restore once.
- **Uploads:** back up `/srv/weeaim-data/uploads` along with the database.
- **Logs:** `journalctl -u weeaim-api -f` (backend) and `journalctl -u weeaim-web -f` (frontend).
- **Uptime:** point an uptime monitor (UptimeRobot, Better Stack…) at `/health`.
- **Server updates:** `sudo apt upgrade` monthly. Docker images update with `docker compose pull`.
- **Costs:** set a monthly usage limit and alerts in the OpenAI dashboard. Web research calls are the most expensive.

### Production troubleshooting

| Symptom | Likely cause |
|---|---|
| Sign-in seems to work but you're immediately signed out | Site not on HTTPS, or the frontend and API are on different domains (the cookie is `Secure` and same-site) |
| "Sign-in is not configured on this server" | `SESSION_SECRET` missing or shorter than 32 characters |
| Google button error `origin_mismatch` | Production domain not in the client's Authorized JavaScript origins |
| Every page says "temporarily unavailable" | Database down: `docker compose ps`, then `docker compose ... up -d` |
| Frontend calls `localhost:8000` | `NEXT_PUBLIC_API_URL` was wrong at build time. Fix `.env.local`, then `pnpm build` and restart `weeaim-web` |
| Emails not arriving | `scripts.send_test_email` on the server shows the exact SMTP error |
