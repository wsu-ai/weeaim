# Sign up, email verification and approval

New users can create their own WEEAIM account with their own email address
and a password. Access is still controlled: every new account waits for an
administrator to approve it before it can see any data.

Google sign-in ([google-sign-in.md](google-sign-in.md)) keeps working
alongside password accounts.

## The user's journey

1. **Sign up.** The user clicks **Sign up** on the sign-in page and fills in
   the registration form (fields below).
2. **Verify the email.** WEEAIM emails a 6-digit code, valid for 15 minutes.
   The user enters it on the next screen. The password is also required, so
   only the person who chose it can activate the account. If they close the
   page, they can verify later: signing in tells them the email isn't
   verified and links to **/verify-email**.
3. **Wait for approval.** The account is now *pending*. Signing in shows
   "awaiting administrator approval".
4. **Approval.** An administrator approves the account and places it in an
   organization. The user gets an email and can then sign in with their
   email and password.

**Forgot password?** on the sign-in page emails a reset code. The user
enters it with a new password. A reset also clears any sign-in lockout.

## Registration fields

| Field | Required | Why |
|---|---|---|
| Full name | Yes | Shown in the app and audit trail; lets administrators recognise the person |
| Email | Yes | Login ID and contact address (stored lower-case) |
| Password + confirmation | Yes | See the policy below |
| Affiliation | Yes | Woosong student / faculty or staff / alumni, external founder, other. Helps the administrator decide on approval and the organization |
| School or organization name | For external founders and "other" | Set to "Woosong University" for Woosong affiliations |
| Department or major | No | Context for program administrators |
| Preferred language | Yes (defaults to the page language) | Language of WEEAIM's emails |
| How you plan to use WEEAIM | Yes, 10–500 characters | Shown to the administrator when reviewing |
| Terms of Use | Yes | |
| Personal information consent | Yes (separate checkbox, as PIPA requires) | |
| AI processing acknowledgement | Yes | Submitted content is processed by OpenAI |

Each consent is stored in `user_consents` with a timestamp and the policy
version (`POLICY_VERSION` in `backend/app/schemas.py`, currently
`2026-10-draft`).

> **Before launch:** the Terms of Use and the privacy notice shown on the
> sign-up page are **draft placeholders**. Woosong's legal or privacy office
> must review them, covering the purpose, retention period and the
> overseas transfer to OpenAI. When the text changes, bump
> `POLICY_VERSION`.

Deliberately **not** collected: phone number, birth date, student or
employee ID, and address. The app doesn't need them.

## Approving and rejecting sign-ups (administrators)

### The admin dashboard

Anyone who is an **owner or admin of an organization** sees an **Admin**
link in the top bar once signed in. It opens **/admin/signups**:

- **Pending:** everyone who verified their email and is waiting. Each card
  shows the applicant's name, email, affiliation, department, language,
  dates and planned use.
  - To approve, choose the organization and role, then click **Approve**.
  - To reject, click **Reject**, optionally write a note (it's included in
    the email), then click **Confirm rejection**.
- **Approved / Rejected:** recent decisions, who made them, when, and any
  note.

Rules, enforced by the server:
- You can approve only into organizations **you** own or administer.
- Admins can grant *member* or *admin*; only owners can grant *owner*.
- If another administrator already handled a request, you'll see "already
  reviewed" and the list refreshes.
- The applicant is emailed either way. If the email fails, the decision
  still stands and the dashboard warns you.
- Every org owner or admin can see all pending applicants' registration
  details. Keep the set of owners and admins small.

Approvals are also written to the organization's audit log
(`signup.approved`). Who reviewed each request is stored on the user
(`reviewed_by_user_id`, `reviewed_at`, `review_note`).

### Command line (alternative)

From `backend/` with the virtual environment active:

```powershell
# Who's waiting? Shows only accounts that verified their email.
python -m scripts.manage_signups list

# Approve into an organization (it must already exist)
python -m scripts.manage_signups approve --email new.user@example.com --org-slug woosong
python -m scripts.manage_signups approve --email lead@example.com --org-slug woosong --role admin

# Reject, with an optional note included in the email
python -m scripts.manage_signups reject --email someone@example.com --note "Pilot is limited to Woosong students"
```

The command line can approve into any organization, because it runs with
direct database access. To create an organization, use
`python -m scripts.invite_user ... --org-name "..."`. To be emailed when
someone verifies a new sign-up, set `SIGNUP_NOTIFY_EMAIL` in `.env`.

To disable an existing account, set its status to `disabled`. Access ends
immediately, including sessions already open:

```sql
UPDATE users SET account_status = 'disabled' WHERE lower(email) = 'someone@example.com';
```

## Email setup

WEEAIM sends verification codes, reset codes and approval notices.

### Local development: console backend (the default)

With `EMAIL_BACKEND=console` (or unset), nothing is sent. Each email,
including its code, is printed in the **backend terminal** (the uvicorn
window), headed `EMAIL_BACKEND=console -- not sent, logged instead.` Copy
the code from there.

### Real email: SMTP

Add to the repository-root `.env`:

```
EMAIL_BACKEND=smtp
EMAIL_FROM=WEEAIM <no-reply@your-domain>
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USERNAME=...
SMTP_PASSWORD=...
SMTP_USE_TLS=true
SIGNUP_NOTIFY_EMAIL=admin@your-domain     # optional
```

Some common providers:
- **Google Workspace:** `smtp.gmail.com:587` with an account and an
  [App Password](https://support.google.com/accounts/answer/185833), or the
  Workspace SMTP relay (`smtp-relay.gmail.com`) configured by your admin.
- **SendGrid:** `smtp.sendgrid.net:587`, username `apikey`, password = the
  API key.
- **Amazon SES, Mailgun, etc.:** use their SMTP credentials.

Restart the backend after changing `.env`. If sending fails, the user sees
"Email could not be sent. Please try again later." and the error is logged.
Codes are also signed with `SESSION_SECRET`, so set that too
([google-sign-in.md](google-sign-in.md)).

## Security details

- **Passwords:**
  - Argon2id hashes (`argon2-cffi`); the plain password is never stored or
    logged.
  - Policy: 10–128 characters, and must not contain the email's name part.
    There are no forced symbol rules, following NIST SP 800-63B.
- **Lockout:** 5 wrong passwords lock the account for 15 minutes. A password
  reset unlocks it. Configure with `LOGIN_MAX_FAILED_ATTEMPTS` and
  `LOGIN_LOCKOUT_MINUTES`.
- **Codes:**
  - Six random digits, stored only as an HMAC.
  - Each code expires after 15 minutes and allows 5 tries.
  - A new code is issued at most once a minute, and it retires the previous
    one.
- **No account enumeration:**
  - Sign-up, resend and forgot-password give the same answer whether or not
    the email exists.
  - Signing up with an email that already has an account emails that
    address instead, telling the owner to sign in or reset their password.
  - Wrong password and unknown email return the same error.
  - Account states (unverified, pending, disabled) are only revealed after
    the correct password.
- **Unfinished sign-ups:** a sign-up that was never verified can be
  overwritten by a new sign-up for the same address. Activating it requires
  both the emailed code and that sign-up's password.
- **Every request** re-checks that the account is active and still a member
  of the organization.
