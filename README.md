# The Free Code Subculture — website & backend

A static site for The Free Code Subculture with a self-hosted admin backend.
The frontend has no build step, framework or bundler. The backend is Node,
TypeScript, Express and PostgreSQL, deployed under PM2.

| Part | Where |
|---|---|
| Frontend | `https://thefreecodesubculture.github.io/fcs-site/` |
| Backend API | `https://fcs-api.akos-archives.in` |
| Backend source | `backend/` |
| VPS | `31.97.137.19` |
| Frontend deploy | GitHub Pages |
| Backend deploy | self-hosted GitHub Actions runner |

## Repository layout

```text
index.html, admin.html, subscribe.html, privacy.html
css/, js/, assets/, data/          frontend
js/api.js                          the only module that talks to the backend
backend/                           Node/TypeScript/PostgreSQL API
tools/                             build and browser-check helpers
```

## Run the frontend locally

```bash
python -m http.server 8000
```

Open <http://localhost:8000>. The site reads the API configured in
`js/config.js` and falls back to the seed data in `js/data.js` when the API
is unreachable.

If you use the hosted backend, the frontend origin must be
`http://localhost:8000` (not `127.0.0.1`) because that is what the API's CORS
allowlist contains.

## Run the backend locally

Requirements: Node 22 and PostgreSQL 16.

```bash
cd backend
cp .env.example .env
npm ci
npm run db:migrate
npm run dev
```

The API listens on `http://127.0.0.1:5050`. See `backend/README.md` for the
environment variables and the available routes.

## Tests

```bash
npm test                 # frontend unit tests
cd backend
npm run typecheck
npm run lint
npm test                 # unit tests
npm run test:integration # needs a test PostgreSQL database
npm run build
```

The frontend browser check is optional and needs Playwright:

```bash
npm install --no-save --no-package-lock playwright
node tools/verify-page.mjs http://localhost:8000/
```

## Admin panel

<http://localhost:8000/admin.html> locally; `/admin` once deployed.

- New accounts are invite-only.
- Admins manage editors and analytics access on the Team page.
- Editors can add and edit; only admins can delete.
- The content pages are Events, Class schedule, Core members, Study groups,
  Resources, Social links, Repositories and Blog.

## Where content lives

| Content | Source |
|---|---|
| Principles, contribution lanes | Fixed page copy in `js/data.js` |
| Events, schedule, resources, study groups, social links, core members, blog | PostgreSQL through the backend API |
| Projects | GitHub API, refreshed into `data/github.json` by the deploy |
| Fallback for database content | the `SEED_*` arrays in `js/data.js` |

The `SEED_*` arrays are a fallback only. Edit content in the admin panel, not
in code. The admin panel writes to the backend API.

## CI/CD

### Pull requests

`.github/workflows/ci.yml` runs on every pull request:

- **Frontend tests** on a GitHub-hosted runner: `npm ci`, `npm test`.
- **Backend tests** on a GitHub-hosted runner with a PostgreSQL 16 service:
  lint, typecheck, migrations, unit and integration tests, build.

A pull request never deploys anything. Merge only after the two checks pass
and branch protection is enabled.

### Merge to `master`

- `.github/workflows/deploy-backend.yml` runs only when `backend/**` changes.
  It runs the CI workflow first, then deploys on the self-hosted
  `fcs-deploy` runner:
  - builds to a new `/srv/fcs-api/releases/<commit>/`
  - runs database migrations
  - switches `/srv/fcs-api/current`
  - reloads PM2
  - checks `/health`
  - rolls back to the previous release if the health check fails
- `.github/workflows/pages.yml` builds the static blog and link-preview
  cards, stages only the frontend into `_site/`, and deploys GitHub Pages.
  It runs on `master`, on a 30-minute schedule, and manually.

## Backend security model

- The frontend holds no database credentials and no service keys.
- Public API routes only return published/active rows.
- Admin routes require a JWT; editor/admin rules are enforced server-side.
- Subscriptions and raw analytics are admin-only.
- Passwords are bcrypt hashes. Refresh tokens are hashed in the database and
  rotated on use.
- CORS allows only the published frontend origin and localhost development.
- A Content-Security-Policy on every page allows only this site, the backend
  origin, GitHub and Discord.

Secrets live in `/srv/fcs-api/shared/.env` on the VPS, mode `600`, owned by
the `fcs` user. They are never committed.

## Notes and limits

- The backend runs as the `fcs` user under PM2; the PM2 service is enabled at
  boot.
- PostgreSQL backups run daily and are restore-tested.
- GitHub Pages is the public frontend. The API is a separate HTTPS origin.
- If the API is unreachable, public content falls back to the seed data; the
  admin panel shows an error instead of silently losing edits.
- The blog is written in PostgreSQL and built into static pages on each
  deploy. Images are committed to the public `fcs-assets` GitHub repository.
