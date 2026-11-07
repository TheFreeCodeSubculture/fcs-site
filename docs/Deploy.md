# FCS Site — Deploy & Toolchain Guide

This guide covers everything needed to run the site locally, deploy it, configure the supporting services, and understand the edge functions.

---

## Table of Contents

1. [Running Locally](#1-running-locally)
2. [Project Structure](#2-project-structure)
3. [Configuration](#3-configuration)
4. [Build Scripts](#4-build-scripts)
5. [GitHub Actions Deploy](#5-github-actions-deploy)
6. [Edge Functions](#6-edge-functions)
7. [Supabase Setup](#7-supabase-setup)
8. [Email Setup (SMTP + Templates)](#8-email-setup-smtp--templates)
9. [Image Uploads Setup](#9-image-uploads-setup)
10. [Unsplash Setup](#10-unsplash-setup)
11. [Calendar Feed](#11-calendar-feed)
12. [OG Cards](#12-og-cards)
13. [Testing](#13-testing)
14. [Rate Limits & Degradation](#14-rate-limits--degradation)

---

## 1. Running Locally

No build step, no bundler. The site runs directly from the filesystem with any HTTP server.

```bash
# Python (Windows: python, not python3)
python -m http.server 8000

# Then open:
# http://localhost:8000       — public site
# http://localhost:8000/admin.html — admin panel
```

The site reads from the seed data in `js/data.js` when Supabase is not configured. All sections render; they just show placeholder content.

**To run with a live database:** paste your Supabase project URL and anon key into `js/config.js`. The admin panel will connect immediately.

**To preview the blog locally:**
```bash
npm ci          # installs satori and sharp (for OG cards)
node tools/blog-build.mjs
```
This writes `blog/` with all published posts. The home page's Blog section then shows the three newest.

---

## 2. Project Structure

```
fcs-site/
├── index.html              Public home page
├── admin.html              Admin panel
├── privacy.html            Privacy policy
├── subscribe.html          Email unsubscribe landing page
├── css/
│   ├── style.css           Main stylesheet (tokens, sections)
│   ├── admin.css           Admin panel layout
│   └── blog-editor.css     Blog editor
├── js/
│   ├── config.js           Supabase URL + anon key
│   ├── data.js             Seed data + fixed copy
│   ├── main.js             Public page JS (module)
│   ├── admin.js            Admin panel JS (module)
│   ├── blog-editor.js      Block editor (module)
│   ├── supabase.js         All DB operations
│   ├── render.js           Shared HTML builders
│   ├── theme.js / theme-init.js
│   ├── track.js            Analytics beacon
│   ├── footer-sky.js       Animated canvas background
│   ├── post-rail.js        Blog post sidebar
│   ├── link-preview.js     Bookmark hover cards
│   ├── image-zoom.js       Lightbox
│   ├── member-picker.js    Author picker dialog
│   ├── medium-import.js    Medium import dialog
│   ├── page-transitions.js Soft navigation
│   ├── subscribe.js        Unsubscribe page logic
│   └── lib/                Pure library modules
│       ├── markdown.js     Block parser/serialiser/renderer
│       ├── block-diff.js   Block diffing for version history
│       ├── blog-pages.js   Static page builders (shared by tools)
│       ├── attribution.js  Medium attribution line helpers
│       ├── bird.js         Pixel art bird animation
│       ├── countdown.js    Live countdown timer
│       ├── derive.js       Event state from timestamps
│       ├── events-view.js  Events section rendering
│       ├── forms.js        slugify, date helpers
│       ├── ics.js          iCalendar file builder
│       ├── member-match.js Email → member card matching
│       ├── medium-wizard.js Medium HTML → blocks
│       ├── repos.js        Repo card helpers
│       └── schedule.js     Next occurrence from class sessions
├── tools/
│   ├── blog-build.mjs      Write blog static pages
│   ├── og.mjs              Draw OG cards (satori + sharp)
│   ├── events-feed.mjs     Write events.ics
│   ├── github-snapshot.mjs Write data/github.json
│   ├── link-meta.mjs       Fetch bookmark metadata
│   ├── email-templates.mjs Push email templates to Supabase Auth
│   ├── build-cover-gallery.mjs Build cover-gallery.json
│   ├── build-pixel-icons.mjs   Rebuild pixel-icons.svg
│   ├── build-brand-assets.mjs  Regenerate brand PNGs
│   ├── shoot.mjs / shoot-core.mjs  Screenshot checks
│   ├── verify-page.mjs     Playwright: public page smoke test
│   ├── verify-admin.mjs    Playwright: admin panel smoke test
│   └── verify-deeplinks.mjs Playwright: hash navigation test
├── supabase/
│   ├── schema.sql          Base schema + RLS + seed data
│   ├── migrations/         SQL patches (run in number order)
│   └── functions/          Deno edge functions
│       ├── collect/        Analytics beacon receiver
│       ├── event-mail/     Email signup and send
│       ├── invite-member/  Supabase Auth invite + role
│       ├── medium-import/  Medium RSS → blocks + image copy
│       ├── refresh-site/   Dispatch GitHub Actions workflow
│       ├── unsplash/       Unsplash search proxy
│       └── upload-asset/   Image → fcs-assets GitHub repo
├── assets/
│   ├── icons.svg           Sprite sheet (all UI icons)
│   ├── pixel-icons.svg     Pixelarticons sprite
│   ├── logoicon.svg        Logo mark (favicon)
│   ├── fcs-lockup.png      Hero logo lockup
│   ├── fcs-mark-large.png  Icarus mark
│   ├── covers/             Cover gallery texture PNGs
│   ├── fonts/              Latin Modern Mono + Garet (vendored)
│   └── cover-gallery.json  Cover picker catalogue
├── data/
│   └── github.json         GitHub org snapshot (written by workflow)
├── blog/                   Static output (written by blog-build.mjs)
│   ├── index.html
│   ├── latest.html         The three newest posts (injected into index.html)
│   ├── <slug>/index.html
│   └── og/                 OG cards
└── docs/                   Documentation (this file and companions)
```

---

## 3. Configuration

### `js/config.js`

```js
window.FCS_CONFIG = {
  supabaseUrl:     "https://<ref>.supabase.co",
  supabaseAnonKey: "eyJ…",

  communityName:   "The Free Code Subculture",

  weekdays: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  defaultTimezone: "Asia/Kolkata",
};
```

- `supabaseUrl` and `supabaseAnonKey`: from your Supabase project's API settings.
- Leaving them blank makes the site run from seed data only.
- **Never put the service-role key here.**

### Content-Security-Policy

Both `index.html` and `admin.html` carry a CSP `<meta>` tag. If you add a new external service, add its origin to `connect-src` in both files.

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com;
img-src 'self' data: https:;
connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.github.com https://discord.com;
object-src 'none';
base-uri 'self';
form-action 'self';
```

The admin's CSP also allows `https://api.microlink.io` (bookmark previews) and `frame-src https://www.youtube-nocookie.com` (video embeds).

---

## 4. Build Scripts

All scripts are Node.js ESM. Run with `node tools/<script>.mjs`.

### `blog-build.mjs`

Writes the entire blog as static HTML.

```
Input:  Supabase blog_posts (published only)
Output: blog/index.html
        blog/<slug>/index.html  (one per post)
        blog/latest.html        (three newest post cards)
        sitemap.xml
        blog/<slug>/og.jpg      (via og.mjs)
        blog/og/blog.jpg
        blog/og/home.jpg
```

Reads the config from `js/config.js` (regex, not import). Fails if Supabase is unreachable, so a bad run never replaces a good site with an empty blog.

**Local preview:**
```bash
npm ci
node tools/blog-build.mjs
python -m http.server 8000
```

### `og.mjs`

Draws 1200×630 JPEG OG cards using **satori** (HTML→SVG) and **sharp** (SVG→JPEG). The only npm devDependencies.

Cards for posts include: title, excerpt, authors (avatars), published date, cover image, icon.

Each post's card URL includes `?v=<updated_at>` so social networks re-fetch on edit.

### `events-feed.mjs`

Writes `events.ics` from all published events (all stages except `draft`). Used for the calendar subscribe feature.

### `github-snapshot.mjs`

Fetches all public repos from the GitHub API and writes `data/github.json`. Run by the workflow with its own `GITHUB_TOKEN`; unauthenticated fetches hit the 60-req/hr limit.

```json
{
  "repos": [ { "id", "name", "description", "url", "stargazers_count", … } ],
  "commits": [ { "repo", "message", "author", "date", "url" } ],
  "fetched_at": "ISO timestamp"
}
```

### `link-meta.mjs`

Fetches `<title>`, description, and OG image for URLs used in `@[bookmark]` blocks. Called by `blog-build.mjs` for the published version (the editor uses microlink.io at edit time).

### `email-templates.mjs`

Generates branded Supabase Auth email templates and either prints them or pushes them to Supabase via the Management API.

```bash
# Preview (prints HTML):
node tools/email-templates.mjs

# Push to Supabase:
SUPABASE_ACCESS_TOKEN=sbp_... node tools/email-templates.mjs --push
```

Templates: invite, reset password, password changed, email changed, confirm signup, magic link, change email, verification code.

The generated HTML is also committed to `supabase/email/` for reference.

### `build-cover-gallery.mjs`

Builds `assets/cover-gallery.json` with solid colours, gradients, textures, and public-domain images. Renders texture PNGs into `assets/covers/`.

### `build-pixel-icons.mjs`

Rebuilds `assets/pixel-icons.svg` from the pixelarticons source. Run when upgrading the pixelarticons package.

---

## 5. GitHub Actions Deploy

The workflow lives at `.github/workflows/pages.yml`.

**Triggers:**
- Every push to `master`
- Every 30 minutes (`schedule: cron: '*/30 * * * *'`)
- Manual dispatch from the Actions tab

**Steps:**
1. `npm ci`
2. `npm test` (Node built-in test runner on `js/lib/*.test.js`)
3. `node tools/github-snapshot.mjs` → `data/github.json`
4. `node tools/events-feed.mjs` → `events.ics`
5. `node tools/blog-build.mjs` → `blog/`
6. Upload and deploy with the GitHub Pages action

**One-time setup:**
- Settings → Pages → Build and deployment → Source: **GitHub Actions**

The `GITHUB_TOKEN` provided by GitHub Actions is used by `github-snapshot.mjs` to fetch the org's repos with authentication (5000 req/hr instead of 60).

> [!NOTE]
> GitHub pauses scheduled workflows in repositories with no activity for 60 days. Any push re-enables them. The site falls back to the GitHub API in the meantime (60 req/hr per visitor IP).

`.nojekyll` prevents GitHub Pages from treating the site as a Jekyll project.

### On-demand redeploy (`refresh-site`)

When an editor publishes or updates a blog post, or uses the "Refresh now" button on the Repositories page, the admin panel calls the `refresh-site` edge function:

```js
// supabase/functions/refresh-site/index.ts
// Checks caller is editor/admin, then calls:
// POST https://api.github.com/repos/TheFreeCodeSubculture/fcs-site/dispatches
// { event_type: "refresh" }
```

This triggers a manual workflow dispatch, which runs the full deploy. The post appears in about one minute.

**Setup:** create a fine-grained GitHub PAT:
- Resource owner: `TheFreeCodeSubculture`
- Repository: `fcs-site` only
- Permission: **Actions: Read and write**

Then add it as the Supabase edge function secret `GITHUB_DISPATCH_TOKEN`.

---

## 6. Edge Functions

All edge functions are Deno TypeScript, deployed to Supabase Edge. Source in `supabase/functions/`.

### `collect`

Receives analytics beacons from `js/track.js`. Hashes the visitor identifier server-side (daily random salt + IP + UA). Inserts into `analytics_events`. Never stores IP addresses.

**Endpoint:** POST `/functions/v1/collect`

### `event-mail`

Handles email subscriptions and admin sends.

Operations:
- Subscribe to an event (or all events)
- Confirm a subscription (via token in email link)
- Unsubscribe (via token in unsubscribe link)
- Send a campaign (admin only)

Sends through Gmail SMTP.

**Secrets needed:** `GMAIL_USER`, `GMAIL_APP_PASSWORD`

### `invite-member`

Checks the caller is an admin, sends a Supabase Auth invite email, and sets the chosen role.

Uses the **service-role key** (available to edge functions only, never in the browser).

### `medium-import`

Fetches a Medium story's public RSS feed, parses it into blocks (using the same logic as `js/lib/medium-wizard.js`), copies images to `fcs-assets`, and returns the resulting Markdown.

**Secrets needed:** `GITHUB_ASSETS_TOKEN`

### `refresh-site`

Dispatches a GitHub Actions workflow run via the GitHub API.

**Secrets needed:** `GITHUB_DISPATCH_TOKEN`

### `unsplash`

Proxies Unsplash API searches, keeping the API key server-side.

**Secrets needed:** `UNSPLASH_ACCESS_KEY`

### `upload-asset`

Receives a file from the editor, checks file type and size (PNG/JPEG/WebP, ≤2 MB), and commits it to `TheFreeCodeSubculture/fcs-assets` via the GitHub API. Returns a jsDelivr CDN URL pinned to the commit SHA.

**Secrets needed:** `GITHUB_ASSETS_TOKEN`

---

## 7. Supabase Setup

1. Create a free project at [supabase.com](https://supabase.com).
2. Run `supabase/schema.sql` in the SQL editor.
3. Run each file in `supabase/migrations/` in number order.
4. Paste the project URL and anon key into `js/config.js`.
5. Create your account under **Authentication → Users**.
6. Promote yourself to admin:
   ```sql
   UPDATE public.profiles SET role = 'admin' WHERE email = 'you@example.com';
   ```
7. Set edge function secrets (see [Edge Functions](#6-edge-functions)).

**To prevent public signups** (recommended for a closed club):
- Authentication → Sign In / Providers → turn off "Allow new users to sign up".
- Use the Team page's Send invite button to invite people from then on.

**Admin panel redirect URLs:** `admin.html` must be listed under Authentication → URL Configuration → Redirect URLs for both localhost and the Pages URL. This is needed for password reset and invite links to work.

---

## 8. Email Setup (SMTP + Templates)

Supabase's built-in email service only delivers to Supabase team members, a few per hour. For production, configure an SMTP server.

### Using Gmail

1. On the club's Google account, turn on **2-Step Verification**.
2. Create an **App password** (Google Account → Security → App passwords).
3. Supabase → Authentication → Emails → SMTP Settings → enable custom SMTP:
   - Host: `smtp.gmail.com`, port: `465`
   - Username: the full Gmail address; password: the app password
   - Sender email: same Gmail; sender name: `The Free Code Subculture`

Gmail allows ~500 emails per day, far more than a club needs.

### Push branded templates

```bash
SUPABASE_ACCESS_TOKEN=sbp_... node tools/email-templates.mjs --push
```

This pushes all templates and enables the "password changed" and "email changed" security notices. Generated HTML is also in `supabase/email/` for manual copy-paste.

### Edge function email secrets

For `event-mail` to send campaigns:
- Supabase → Edge Functions → Secrets:
  - `GMAIL_USER` = `thefreecodesyndicate@gmail.com`
  - `GMAIL_APP_PASSWORD` = the 16-character app password

---

## 9. Image Uploads Setup

Blog images and member photos are stored in the public `TheFreeCodeSubculture/fcs-assets` GitHub repository and served by jsDelivr.

**Setup:**
1. Run migrations `022_blog_posts.sql` through `028_profile_member_link.sql`.
2. Create a fine-grained GitHub PAT:
   - Resource owner: `TheFreeCodeSubculture`
   - Repository: `fcs-assets` only
   - Permission: **Contents: Read and write**
3. Supabase → Edge Functions → Secrets: `GITHUB_ASSETS_TOKEN` = the token.

**URL format:** `https://cdn.jsdelivr.net/gh/TheFreeCodeSubculture/fcs-assets@<sha>/path/to/file.webp`

The URL is pinned to the commit SHA: it never changes after upload, and no cache purge is ever needed.

> [!WARNING]
> `fcs-assets` is a **public** repository. Every uploaded file is permanently publicly accessible. Never upload any private or sensitive content.

---

## 10. Unsplash Setup

The blog editor's cover picker has an Unsplash tab for searching free photos.

**Setup:**
1. Create an app at [unsplash.com/oauth/applications](https://unsplash.com/oauth/applications) (free).
2. The app starts in demo mode: 50 searches per hour per person.
3. Add the app's **Access Key** as the Supabase edge function secret `UNSPLASH_ACCESS_KEY`.
4. Apply for production use in the Unsplash developer portal when ready (unlimited searches).

Photos are **hotlinked** from Unsplash (not uploaded to `fcs-assets`). Photographers' names are credited automatically in `cover_credit` and shown in the published post. This is required by Unsplash's API guidelines.

---

## 11. Calendar Feed

The deploy workflow writes `events.ics` every 30 minutes via `tools/events-feed.mjs`. It includes all published events (all stages except `draft`).

The events section's "Add to your calendar" menu subscribes to it:
- **Google Calendar:** a URL built dynamically from the site's `events.ics` path.
- **Apple / Outlook:** a `webcal://` link to `events.ics`.
- **Copy link:** copies the `https://` URL to the clipboard.
- **Download one-off file:** builds a `.ics` in memory from the current event list via `js/lib/ics.js`.

Subscribed calendars pick up new and changed events on their own (Google re-fetches daily; Apple/Outlook vary).

---

## 12. OG Cards

Open Graph cards are drawn at deploy time by `tools/og.mjs` using **satori** (HTML→SVG) and **sharp** (SVG→JPEG). They are written as JPEG files and served as static assets.

| File | Used by |
|------|---------|
| `blog/<slug>/og.jpg` | Each post |
| `blog/og/blog.jpg` | The blog index (`blog/index.html`) |
| `blog/og/home.jpg` | The home page (`index.html`) and `privacy.html` |

Each card URL includes `?v=<updated_at>` so Discord, WhatsApp, and X re-fetch the card after a post is edited.

**To refresh a card that was already shared:**
- Facebook: [Sharing Debugger](https://developers.facebook.com/tools/debug/) → "Scrape again"
- LinkedIn: [Post Inspector](https://www.linkedin.com/post-inspector/)
- Telegram: message [@WebpageBot](https://t.me/WebpageBot) with the URL

---

## 13. Testing

### Unit tests

```bash
npm test
```

Runs Node's built-in test runner on all `js/lib/*.test.js` files. These test pure library functions (markdown parser, block diff, forms, ICS, schedule, etc.) without a browser or Supabase.

### Playwright smoke tests

Playwright is not a project dependency. Install it once:

```bash
npm install --no-save --no-package-lock playwright
```

Then run the checks against the local server:

```bash
# Start the server first:
python -m http.server 8000

# In a second terminal:
node tools/verify-page.mjs      http://localhost:8000/
node tools/verify-admin.mjs     http://localhost:8000/
node tools/verify-deeplinks.mjs http://localhost:8000/
```

- `verify-page.mjs` — checks the public home page renders without JS errors, all sections are visible, and the GitHub section loads.
- `verify-admin.mjs` — checks the admin panel sign-in screen renders and the pixel field plays.
- `verify-deeplinks.mjs` — navigates to each `#/` hash and checks the section renders.

### Screenshot checks

```bash
node tools/shoot.mjs      http://localhost:8000/
node tools/shoot-core.mjs http://localhost:8000/
```

Saves screenshots to `.shots/` for visual regression comparison.

---

## 14. Rate Limits & Degradation

| Service | Limit | Degradation |
|---------|-------|-------------|
| GitHub API (unauthenticated) | 60 req/hr per visitor IP | Falls back to `data/github.json` (refreshed by workflow every 30 min). If that file is also stale, the Projects section shows a link to the org page. |
| GitHub API (workflow token) | 5000 req/hr | Used only by the deploy workflow; not visitor-facing. |
| Supabase free tier | Pauses after inactivity | All sections fall back to seed data in `js/data.js`. Reactivate from the Supabase dashboard. |
| Supabase Realtime | Included in free tier | Used for live role changes and analytics. Degrades silently if the connection drops. |
| microlink.io (bookmark previews in editor) | ~50 new URLs/day per person | Falls back to showing just the URL if the fetch fails. The deploy-time `link-meta.mjs` is not rate-limited. |
| Unsplash (demo mode) | 50 searches/hr per person | "Rate limit exceeded" error in the cover picker. Apply for production mode to remove it. |
| Gmail SMTP | ~500 emails/day | Email sends fail silently if the limit is hit. |
| Supabase email subscriptions | 100 unconfirmed sign-ups/hr | Excess sign-up requests are rejected with an error. |
