# Deploying WEEAIM: Vercel + Render + Supabase

```
Browser ──► https://<project>.vercel.app          (Vercel: Next.js frontend)
                 │  /api/*  forwarded (next.config.ts rewrites, BACKEND_URL)
                 ▼
           https://weeaim-api.onrender.com         (Render: FastAPI in Docker,
                 │                                   1 GB disk for uploads)
                 ▼
           Supabase Postgres 16 + pgvector          (Seoul region)
```

**Why the forwarding matters:** the browser only ever talks to the Vercel
address. The sign-in cookie is `Secure` and same-site, and production turns
cross-origin requests off. A Vercel address and an onrender.com address are
different sites, so without the forwarding sign-in would not work.

What's in the repository for this:
- `backend/Dockerfile` and `backend/docker-entrypoint.sh`: run migrations, then serve.
- `render.yaml`: the Render Blueprint.
- `frontend/next.config.ts`: the `/api` forwarding.
- Migration `a7c3e5f9d218`: Supabase API hardening.

Do the steps **in order**. Expect about an hour the first time.

---

## Step 1 — GitHub repository

1. On github.com: **New repository**. Name it `weeaim`, make it **Private**, and *don't* add a README or .gitignore.
2. Push the code from the repo root on your PC:
   ```powershell
   git remote add origin https://github.com/<you>/weeaim.git
   git push -u origin master
   git push -u origin feature/accounts-signup-research
   ```
   Deploy from the branch you want live. Merge the feature branch into
   `master` first if `master` should be the live branch.

## Step 2 — Supabase (database)

1. On supabase.com: **New project**.
   - **Region: Northeast Asia (Seoul)**.
   - **Database password:** generate a strong one and save it in your password manager.
2. ⚠️ **Turn off the Data API (required).** Go to **Project Settings → Data API** and switch **Enable Data API** off.
   - **Why:** Supabase publishes database tables over a public REST API. WEEAIM's tables (users, sign-up codes and more) must only be reached through the backend.
   - **Backup:** the app's migrations also revoke those API roles' access.
3. **Get the connection details.** Click **Connect**, open the **Session pooler** tab, and note the **host** (like `aws-0-ap-northeast-2.pooler.supabase.com`) and the **project ref** (the `xxxx` in `postgres.xxxx`).
   - Use the **Session pooler (port 5432)**.
   - Don't use the *Transaction pooler* (port 6543); it breaks the database driver.
   - Don't use the *Direct connection*; it's IPv6-only, which Render can't reach.
4. Choose two more strong passwords, for the app's own database roles: **APP_DB_PASSWORD** and **SERVICE_DB_PASSWORD**. Use letters and digits only, to avoid URL-escaping issues.

Your three connection URLs (replace `<…>`; keep `?ssl=require`):

```
DATABASE_URL         = postgresql+asyncpg://postgres.<ref>:<SUPABASE_DB_PASSWORD>@<pooler-host>:5432/postgres?ssl=require
APP_DATABASE_URL     = postgresql+asyncpg://venture_app.<ref>:<APP_DB_PASSWORD>@<pooler-host>:5432/postgres?ssl=require
SERVICE_DATABASE_URL = postgresql+asyncpg://venture_service.<ref>:<SERVICE_DB_PASSWORD>@<pooler-host>:5432/postgres?ssl=require
```

If the Supabase password contains symbols, URL-encode them (`@` → `%40`,
`#` → `%23`, `/` → `%2F`). The first deploy's migrations create
`venture_app` and `venture_service` themselves; you don't create them in Supabase.

## Step 3 — Render (backend API)

1. On render.com, sign in with GitHub, then **New → Blueprint**. Pick the `weeaim` repo and the branch to deploy. Render reads `render.yaml`.
2. Fill in the values it asks for:

| Key | Value |
|---|---|
| `DATABASE_URL`, `APP_DATABASE_URL`, `SERVICE_DATABASE_URL` | From step 2 |
| `APP_DB_PASSWORD`, `SERVICE_DB_PASSWORD` | The same two passwords used in those URLs |
| `OPENAI_API_KEY` | A production OpenAI key (set a monthly spending limit in OpenAI) |
| `OPENAI_MODEL` | The model you use locally (must support web search) |
| `GOOGLE_CLIENT_ID` | Your Google OAuth client ID |
| `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD` | Your working email settings from `.env` |
| `SIGNUP_NOTIFY_EMAIL` | Optional: where new sign-up alerts go |

`ENVIRONMENT=production`, `UPLOAD_STORAGE_DIR` and a random `SESSION_SECRET`
are set automatically.

3. Click **Apply**. The first deploy builds the image and runs the database
   migrations (5–10 minutes). The **Starter** plan (about US$7 a month) is
   needed for the upload disk.
4. When it's live, copy the service URL (like `https://weeaim-api.onrender.com`)
   and open `<url>/health`. It should show `{"status":"ok"}`.

### First administrator

In Render, open **weeaim-api → Shell** and run:

```bash
python -m scripts.invite_user --email you@woosong.ac.kr --org-slug woosong --org-name "Woosong University" --role owner
python -m scripts.send_test_email --to you@woosong.ac.kr
```

## Step 4 — Vercel (website)

1. On vercel.com, sign in with GitHub, then **Add New → Project** and import `weeaim`.
2. **Root Directory: `frontend`**. The framework is detected as Next.js.
3. **Environment Variables:**

| Name | Value |
|---|---|
| `BACKEND_URL` | Your Render URL, e.g. `https://weeaim-api.onrender.com` (no trailing slash) |

   Do **not** set `NEXT_PUBLIC_API_URL`. Leaving it empty makes the site call
   its own address, which Vercel forwards.
4. In **Settings → General → Node.js Version**, choose **24.x**, then **Deploy**.
5. Note the site address, e.g. `https://weeaim.vercel.app`.

## Step 5 — Google sign-in

In **Google Cloud Console → Google Auth Platform → Clients → your client →
Authorized JavaScript origins**, add your Vercel address (e.g.
`https://weeaim.vercel.app`). If the consent screen is *External* and in
*Testing*, add your users under **Audience → Test users**, or publish the app.

## Step 6 — Go-live checks

- [ ] `https://<render>/health` → `{"status":"ok"}`
- [ ] **Data API is closed:** in Supabase, copy the *anon* key from **Project Settings → API Keys**, then run
  `curl "https://<ref>.supabase.co/rest/v1/users?select=email" -H "apikey: <anon key>"`.
  It must **not** return any data; an error is the correct result.
- [ ] `https://<vercel>/` loads over HTTPS. The login page has **no** "Development sign-in" section.
- [ ] **Sign in with Google** works for the invited admin, and **Admin** appears in the top bar.
- [ ] Sign up with a second email: the code arrives, then approve it under **Admin**.
- [ ] Create an idea. **Stage 1 research completes** (see the troubleshooting row for long-running research).
- [ ] Upload a document in a venture; it processes.

## Updating

Push to the deployed branch. Render and Vercel rebuild automatically, and new
migrations run when the backend starts. Run the tests locally first, and take
a database backup in Supabase before releases that include migrations.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Render deploy fails at `alembic upgrade head` with *permission denied to create role* or *must have BYPASSRLS* | Supabase's `postgres` role can't grant that right. Ask me for the fallback (create `venture_service` without BYPASSRLS; the running app doesn't use it) |
| Render log: *password authentication failed for user "venture_app"* | `APP_DB_PASSWORD` differs from the password inside `APP_DATABASE_URL`, or the user isn't written as `venture_app.<ref>` |
| Render log: *prepared statement … does not exist* | You used the Transaction pooler (6543). Switch all three URLs to the Session pooler (5432) |
| Signed in, but immediately signed out / every API call 401 | The site was opened on the onrender.com address, or `BACKEND_URL` is missing on Vercel. Use the Vercel address only, and redeploy Vercel after changing variables |
| Stage 1/4 research fails after about 30–60 s while it works locally | Vercel's forwarding timed out on a long AI call. Fallback: put the site and API on one custom domain (`app.` and `api.` under a Woosong domain), which needs a small CORS change. Ask me |
| "Sign-in is not configured on this server" | `SESSION_SECRET` missing on Render (it should be generated by the Blueprint) |
| Google button error `origin_mismatch` | Add the exact Vercel address in step 5 |
| Vercel build fails installing packages (`ERR_INVALID_THIS`) | Remove `ENABLE_EXPERIMENTAL_COREPACK` if set (with Root Directory `frontend` Vercel can't find the `packageManager` field and falls back to an old pnpm); keep Node at 24.x |
| Supabase project paused | Free projects pause after about a week of no use; resume it in the dashboard, or use a paid plan for real users |
| Emails not arriving | In the Render Shell, `python -m scripts.send_test_email --to you@…` shows the SMTP error |

## Costs (approximate)

| Service | Plan | Cost |
|---|---|---|
| Vercel | Hobby (non-commercial) / Pro | Free / US$20 per month |
| Render | Starter + 1 GB disk | about US$7.25 per month |
| Supabase | Free (pauses when idle) / Pro | Free / US$25 per month |
| OpenAI | Usage-based | Set a spending limit; web research is the costly part |
