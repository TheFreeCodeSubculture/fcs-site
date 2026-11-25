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
src/routes/                route definitions; index.ts mounts every router
src/controllers/           request parsing, validation and response shaping
src/services/              business rules, SQL and external side effects
src/config.ts              environment validation
src/db/                    pool, transactions, migration runner
src/lib/                   generic helpers (http, tokens, passwords, images)
src/middleware/            shared auth guards
src/email/                 SMTP transport and email templates
src/integrations/medium/   Medium parsing helpers and HTTP adapter
migrations/                numbered, applied once and recorded
test/                      unit and integration tests
```

The layers are deliberately flat and conventional:

- `routes/*.routes.ts` — URLs and route middleware only. Related public and
  admin endpoints share one file (blog posts and blog drafts, for example).
  `routes/index.ts` is the single mount point for every router.
- `controllers/*.controller.ts` — zod validation, request parsing and the shape
  of the response. Controllers never contain SQL.
- `services/*.service.ts` — business rules, database queries and external calls.
  Only areas with real logic get a service.
- `integrations/medium/` — the Medium importer's pure helpers plus the small
  HTTP adapter. The `.js` helpers stay here because the frontend tests import
  them directly.

Shared code lives in `lib/`, `middleware/`, `db/` and `email/`. To add a
feature, add a route file (and a controller/service only if the feature needs
one), then mount the router in `src/routes/index.ts`.

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
| `LOG_LEVEL` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent` |
| `JWT_SECRET` | signs short-lived access tokens |
| `REFRESH_TOKEN_PEPPER` | hashes refresh tokens in the database |
| `SITE_ORIGINS` | comma-separated browser origins allowed by CORS |
| `PUBLIC_API_URL` | this API's public URL, used in links |
| `PUBLIC_SITE_URL` | frontend URL, used for reset and invite links |
| `MEDIA_DIR` | uploaded member photos |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD` | outbound email |
| `GITHUB_ASSETS_TOKEN` | writes blog images to `fcs-assets` |
| `GITHUB_DISPATCH_TOKEN` | triggers the Pages rebuild |
| `GITHUB_ORG` | organisation whose public repositories are listed (default `TheFreeCodeSubculture`) |
| `GITHUB_READ_TOKEN` | optional; reads public repositories with a 5,000 req/hr limit instead of 60 |
| `UNSPLASH_ACCESS_KEY` | optional cover picker |

Production reads `/srv/fcs-api/shared/.env` (mode `600`, owned by `fcs`).
`FCS_ENV_FILE` points at it; nothing secret is committed.

## Logging

The app writes structured JSON with Pino to stdout. PM2 captures it in:

```text
/srv/fcs-api/shared/logs/out.log
/srv/fcs-api/shared/logs/error.log
```

`LOG_LEVEL` controls the level. Tests run at `silent`.

Request logs redact:

- `Authorization` and cookie headers
- API keys
- forwarded client IP headers (`x-real-ip`, `x-forwarded-for`, `cf-connecting-ip`)
- password, token and refresh-token fields
- `Set-Cookie` response headers

`pm2-logrotate` is configured for 10 MB files, 14 days of retention, gzip
compression and a daily rotation. The PM2 process uses `wait_ready`, a 10-second
listen timeout and a 10-second kill timeout, so reloads wait for the app to bind
before the health check runs.

Useful commands:

```bash
sudo -u fcs -H pm2 logs fcs-backend --lines 100
sudo -u fcs -H pm2 describe fcs-backend
sudo -u fcs -H pm2 conf pm2-logrotate
```

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
at production. Use a **separate test role** as well as a separate database;
do not reuse the production `fcs_app` role or change its password. On a local
PostgreSQL installation:

```bash
sudo -u postgres psql <<'SQL'
create role fcs_test_app login password 'test';
create database fcs_test owner fcs_test_app;
SQL
```

Then use `postgres://fcs_test_app:test@127.0.0.1:5432/fcs_test`. The test
config also refuses to run if the database name does not contain `test`.

## Migrations

`migrations/` is the schema history, not a one-time setup script. Keep every
applied migration in the repository.

- The runner records each file in `schema_migrations` and prints `skip` for
  files that are already applied.
- Running `npm run db:migrate` again is safe; it does not reapply those files.
- Never edit or delete an applied migration. Add a new numbered file for every
  schema change.
- CI runs the migrations against a fresh PostgreSQL service, and a new VPS or
  disaster-recovery install needs them too.
- If a feature's schema must be removed, write a new drop migration. Do not
  delete the original migration from history.

## Routes

- `/health` — database health.
- `/api/auth/*` — member signup, email verification, login, refresh, logout,
  me, password reset and invite accept.
- `/api/account/*` — member profile editing, avatar upload/removal and the
  all-events email preference; requires a verified account.
- `/api/public/*` — published events, classes, resources, groups, links,
  opted-in member profiles, the cached GitHub repository list and blog posts.
- `/api/admin/*` — CRUD for every content table, team and role management,
  blog drafts and versions, activity history and restore, analytics,
  photo uploads and GitHub actions (image upload, site dispatch and
  repository-cache refresh).
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
${PUBLIC_SITE_URL}/#verify=<token>
```

Member password-reset emails currently link to:

```text
${PUBLIC_SITE_URL}/#type=recovery&token=<token>
```

Admin and editor reset emails still link to `admin.html`. The homepage
handles both member links in the auth dialog; successful verification or
password reset lands on `account.html`, the member profile page.

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
