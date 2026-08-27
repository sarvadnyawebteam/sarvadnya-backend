# Admin Copy — Deployment Fork

> Updated: 2026-08-27

## What This Is

This is the **admin-copy deployment** — a fork of the original
`Orthodox2000/sarvadnya-infotech.git` repository that keeps **full admin
access**. Unlike the frontend-only deployment (which renames `app/admin` →
`app/admin.bak`), this repo keeps the entire admin panel live and is the
deployment with write access to all resources.

### What's Active (not isolated here)
| Path | Role |
|------|------|
| `app/admin/` | 19 admin pages + layout + sidebar |
| `app/api/admin/` | 19 admin API route directories |
| `lib/admin-auth.ts` | Auth library (token, session, validation) |
| `scripts/bootstrap.mjs` | DB seeding script |

Symmetrically, the **frontend-only** deployment lives in the *other* (original)
remote where these are renamed to `.bak`. This fork is the opposite — the admin
panel is present, committed, and deployed.

## Admin Credentials (this fork)

Credentials are hardcoded in `lib/admin-auth.ts`:

| Field | Value |
|-------|-------|
| Username | `sarvadnya` |
| Password | `admin@sarvadnya` |

The session-token signature key is `ADMIN_ACCESS_KEY` (env var). It must be set
for every environment (local `.env`, Vercel project env) or login tokens cannot
be created/verified.

## How Admin Auth Works

1. **Login** — `POST /api/admin/login` calls `validateCredentials()` from
   `lib/admin-auth.ts`, then `createToken()` signs a token with `ADMIN_ACCESS_KEY`
   and sets an httpOnly `__admin_token` cookie.
2. **Session check** — `GET /api/admin/session` (`verifySessionFromCookie()`) is
   called by `app/admin/layout.tsx` on every admin page; a 401 redirects to
   `/admin/login`.
3. **Logout** — `POST /api/admin/logout` clears the cookie.
4. **Route guard** — `proxy.ts` protects `/admin` and `/api/admin` by checking the
   `x-admin-key` header, the `admin_key` cookie, or the `__admin_token` session
   cookie against `ADMIN_ACCESS_KEY`.
5. **Defense-in-depth** — email queue/ledger endpoints additionally use
   `isRequestAuthorized()` from `lib/admin-auth.ts` so a bypassed/misconfigured
   proxy can never expose email sends.

## Security Notes

- **Never commit** the real `ADMIN_ACCESS_KEY` to a shared/published file — keep it
  in Vercel project env and local `.env` (which is gitignored).
- Admin credentials are hardcoded for the fork's internal use. If this fork ever
  needs to be shared more broadly, move them to env vars
  (`ADMIN_USERNAME` / `ADMIN_PASSWORD`).
- `proxy.ts` rate-limits public `/api` routes (60 req/min/IP) — admin routes are
  exempt but still token-guarded.
- Public write surface stays read-only where possible: `app/api/content`,
  `app/api/modules`, `app/api/tutorials` have write methods stripped in the
  frontend deployment; here admin routes are the intended writers.

## Email APIs (safe / unchanged)

Form-submission email triggers remain live and are untouched by isolation:
`/api/email/submit`, `/api/contact`, `/api/tss-renewal`,
`/api/problem-reports`, `lib/email-queue.ts`, `lib/email.ts`.

## Set Up a New Worktree/Clone

```powershell
git clone <admin-remote>
git remote add upstream https://github.com/Orthodox2000/sarvadnya-infotech.git
```

## Deploy Checklist (Vercel — new project on the same account)

- [ ] Connect the fork repo to a **new** Vercel project.
- [ ] Set env vars: `ADMIN_ACCESS_KEY`, `MONGODB_URI`, `MONGODB_DB`,
      `BLOB_READ_WRITE_TOKEN`, `BLOB_STORE_ID`, `GROQ_API_KEY`/`GEMINI_API_KEY`,
      `RESEND_API_KEY`, `RESEND_SENDER_EMAIL`, `RESEND_INTERNAL_TO`.
- [ ] Run `scripts/bootstrap.mjs` once after first deploy to seed
      `EMAIL_FORM_RECIPIENTS` + `RESEND_SENDER_EMAIL`.
- [ ] Verify login with `sarvadnya` / `admin@sarvadnya` and that admin pages + APIs
      respond.

## Related Docs

- `docs/ADMIN-VS-FRONTEND-ISOLATION.md` (if present) covers the original isolation.
