# FCS backend

Node 22 + TypeScript + Express + PostgreSQL. This is the API behind the
static site: public content, authentication, the admin panel, blog drafts,
analytics, email and the GitHub/Medium integrations.

The production API is `https://fcs-api.akos-archives.in` and runs under PM2
as the `fcs` user on the VPS. The frontend stays on GitHub Pages.

## Layout

```text
src/app.ts                 Express app, CORS, security headers, error mapping
src/server.ts              process entry point
src/config.ts              environment validation
src/db/                    pool, transactions, migration runner
src/routes/                auth, account, public, admin, analytics, media,
                           mail, integrations, tracking
src/services/              auth tokens and email delivery
src/integrations/medium/   the Medium importer
migrations/                numbered, applied once and recorded
test/                      unit and integration tests
```

## Local development

Requirements: Node 22 and PostgreSQL 16.

```bash
cd backend
cp .env.example .env      # fill in DATABASE_URL and secrets
npm ci
npm run db:migrate
npm run dev
```

The API listens on `http://127.0.0.1:5050`.

The frontend origin must be in `SITE_ORIGINS`. For the normal local preview
that is `http://localhost:8000` (not `127.0.0.1`).

## Environment

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | signs short-lived access tokens |
| `REFRESH_TOKEN_PEPPER` | hashes refresh tokens in the database |
| `SITE_ORIGINS` | comma-separated browser origins allowed by CORS |
| `PUBLIC_API_URL` | this API's public URL, used in links |
| `PUBLIC_SITE_URL` | frontend URL, used for reset and invite links |
| `MEDIA_DIR` | uploaded member photos |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD` | outbound email |
| `GITHUB_ASSETS_TOKEN` | writes blog images to `fcs-assets` |
| `GITHUB_DISPATCH_TOKEN` | triggers the Pages rebuild |
| `UNSPLASH_ACCESS_KEY` | optional cover picker |

Production reads `/srv/fcs-api/shared/.env` (mode `600`, owned by `fcs`).
`FCS_ENV_FILE` points at it; nothing secret is committed.

## Checks

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

`npm test` runs the unit tests and the integration suite. Integration tests
are skipped unless `TEST_DATABASE_URL` points at a disposable database. The
CI workflow creates a PostgreSQL 16 service and runs migrations first:

```bash
createdb fcs_test
DATABASE_URL=postgres://.../fcs_test npm run db:migrate
TEST_DATABASE_URL=postgres://.../fcs_test npm test
```

The integration suite truncates every application table, so never point it
at production.

## Routes

- `/health` — database health.
- `/api/auth/*` — member signup, email verification, login, refresh, logout,
  me, password reset and invite accept.
- `/api/account/*` — member profile editing and the all-events email
  preference; requires a verified account.
- `/api/public/*` — published events, classes, resources, groups, links,
  opted-in member profiles, repositories and blog posts.
- `/api/admin/*` — CRUD for every content table, team and role management,
  blog drafts and versions, activity history and restore, analytics,
  photo uploads and GitHub actions.
- `/api/event-mail/*` — event subscription confirmation and unsubscribe.
- `/api/integrations/*` — Medium feed/story/import and the GitHub refresh.
- `/api/track` — first-party, cookie-free pageview and event collection.

Admin routes require a JWT. Editors can create and update; only admins can
delete or manage the team. Member accounts are separate: signup is open, but
email verification is required before login, and the public directory only
returns opted-in members without their email addresses.

### Member frontend contract

This repository deliberately does **not** include the member-facing UI. The
backend routes are ready for the frontend developer:

- signup, email verification, login, reset password and profile editing
- the opt-in public directory at `/api/public/members`
- the all-events email preference

Verification emails currently link to:

```text
${PUBLIC_SITE_URL}/account.html#verify=<token>
```

Member password-reset emails currently link to:

```text
${PUBLIC_SITE_URL}/account.html#type=recovery&token=<token>
```

The frontend must provide that page, or the paths in
`src/routes/auth.ts` must be changed to the route the frontend implements.

## Production and deploy

`.github/workflows/deploy-backend.yml` runs on a push to `master` that
changes `backend/**`. It runs the CI workflow, builds a release into
`/srv/fcs-api/releases/<sha>`, installs production dependencies, applies
migrations, switches `/srv/fcs-api/current`, reloads PM2 and checks
`/health`. If the health check fails it points `current` back at the previous
release and reloads PM2.

The self-hosted runner is labelled `fcs-deploy` and runs as the `fcs` user.

```bash
curl -sS https://fcs-api.akos-archives.in/health
```

Expected:

```json
{"ok":true,"db":"up","time":"..."}
```
