# Sign in with Google

WEEAIM users sign in with their existing Google account. Sign-in is
**invite-only**: a Google account gets in only if its email address has been
added to an organization first. The app never creates accounts or
organizations on its own.

## How it works

1. The login page shows Google's official **Sign in with Google** button,
   loaded from Google Identity Services (`accounts.google.com/gsi/client`).
2. The user picks their Google account in Google's pop-up. Google returns a
   signed **ID token** to the page.
3. The page sends the token to `POST /api/auth/google`. The backend verifies
   it itself before trusting anything in it:
   - signature against Google's published keys
   - audience equal to our client ID
   - Google issuer
   - not expired
   - email verified by Google
4. The backend looks up the invited user and links their Google account on
   first sign-in. It matches by Google's stable account ID after that, so a
   changed email address doesn't matter.
5. The backend sets a session cookie: `HttpOnly`, `SameSite=Lax`, `Secure` in
   production, valid for 8 hours by default. Page scripts can't read it.
   Every API call checks the cookie and re-checks organization membership.
6. If the user belongs to more than one organization, they choose one before
   they can reach any venture data.

No client secret is involved; this flow doesn't need one. The client ID is
public by design.

## One-time setup (administrator)

### 1. Create the Google OAuth client

In the [Google Cloud Console](https://console.cloud.google.com/):

1. **Create or select a project**, e.g. "WEEAIM".
2. Open **Google Auth Platform**. In older consoles this is
   **APIs & Services → OAuth consent screen**.
   - **Branding:** app name "WEEAIM", your support email, and optionally the
     Woosong logo.
   - **Audience:**
     - Choose **Internal** if every user has an account in your own Google
       Workspace (e.g. a university domain).
     - Otherwise choose **External**. While the app is in **Testing** status,
       only the Google accounts listed under **Test users** can sign in, up to
       100. Add yourself and your pilot users there, or publish the app when
       you're ready.
   - **Data access (scopes):** `openid`, `email`, `profile`. These are
     non-sensitive, so Google's app verification isn't required for them.
3. Go to **Clients → Create client** (or **Credentials → Create credentials →
   OAuth client ID**):
   - Application type: **Web application**
   - Name: "WEEAIM web"
   - **Authorized JavaScript origins:**
     - `http://localhost:3000` for local development
     - your production origin, e.g. `https://weeaim.example.edu`
   - Authorized redirect URIs: leave empty, because the button uses a pop-up.
4. Copy the **Client ID**. It ends in `.apps.googleusercontent.com`. Ignore the
   client secret; WEEAIM doesn't use it.

### 2. Configure the backend

Add to the repository-root `.env`, which is git-ignored:

```
GOOGLE_CLIENT_ID=1234567890-abc...apps.googleusercontent.com
SESSION_SECRET=<paste the output of the command below>
```

Generate the session secret with:

```
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

- `SESSION_SECRET` signs session cookies. Keep it out of git and out of
  prompts, and use a different one in each environment.
- Changing `SESSION_SECRET` signs everyone out.
- In production the server refuses to sign anyone in without it.
- In local development it falls back to a temporary secret, so sessions end
  whenever the server restarts.

The frontend needs no Google settings: it reads the client ID from
`GET /api/auth/config`.

### 3. Apply the database migration

From `backend/` with the virtual environment active:

```
pip install -r requirements.txt     # adds PyJWT[crypto]
alembic upgrade head                # adds users.google_subject
```

### 4. Invite users

Each person must be invited with the email address of their Google account:

```
# First user: also creates the organization
python -m scripts.invite_user --email professor@gmail.com --org-slug woosong \
    --org-name "Woosong University" --role owner

# Everyone else
python -m scripts.invite_user --email student@gmail.com --org-slug woosong
```

Roles are `owner`, `admin` and `member`. Running the command again is
harmless. Inviting the same email to a second organization gives that person
an organization picker after they sign in.

## Signing in (users)

1. Open the WEEAIM home page.
2. Click **Sign in with Google**.
3. In Google's pop-up, choose the Google account you were invited with. On
   the first sign-in, Google asks you to allow WEEAIM to see your name and
   email address.
4. If you belong to several organizations, choose one.
5. You land on the idea page. **Sign out** is in the top-right corner.

## Local development without Google

When `ENVIRONMENT` isn't `production`, the login page also shows a
**development email sign-in** below the Google button. It accepts any invited
email, such as `dev@weeaim.local` from `python -m scripts.seed_dev_org`, with
no password. It's hidden in production, and its endpoint returns 501 there.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Google pop-up says **"Error 400: origin_mismatch"** or the button doesn't appear | The page's origin isn't listed under the client's *Authorized JavaScript origins*. Add it exactly, including scheme and port, and wait a few minutes. |
| "Google sign-in isn't configured on this server yet." | `GOOGLE_CLIENT_ID` is missing from `.env`. Restart the backend after adding it. |
| "This Google account hasn't been invited." | Run `invite_user` with that exact Google email. The account may also already be linked to a *different* Google account; check `users.google_subject`. |
| "Google sign-in couldn't be verified." | The token was for a different client ID, expired, or the server clock is far off. Check `GOOGLE_CLIENT_ID` matches the console. |
| External app in Testing: "Access blocked" | Add the account under **Audience → Test users**, or publish the app. |
| Signed in, but every API call returns 401 | The browser isn't sending the cookie. In production, serve the frontend and API from the same site (e.g. `app.example.edu` and `api.example.edu`, or one origin behind a reverse proxy) over HTTPS. |
| Everyone was signed out | `SESSION_SECRET` changed, or it isn't set in development and the server restarted. |
