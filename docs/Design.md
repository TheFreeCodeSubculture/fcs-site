# The Free Code Subculture — Design Document

> [!NOTE]
> This is the master design reference for the FCS site. It covers the visual language, architecture, page sections, the blog editor, the admin panel, and the supporting toolchain. Companion guides are linked at the bottom.

---

## Table of Contents

1. [Design Philosophy](#1-design-philosophy)
2. [Architecture Overview](#2-architecture-overview)
3. [Brand & Visual Language](#3-brand--visual-language)
4. [Page Sections](#4-page-sections)
5. [The Admin Panel](#5-the-admin-panel)
6. [The Blog Editor](#6-the-blog-editor)
7. [Data Model](#7-data-model)
8. [Toolchain & Deploy](#8-toolchain--deploy)
9. [Security Model](#9-security-model)
10. [Companion Guides](#10-companion-guides)

---

## 1. Design Philosophy

The site is styled after an **RFC memo** — a numbered, sectioned document with a header block, horizontal rules, and no decorative illustration. The visual language is called **brutalist**: hard edges, flat colour, monospace type, no softening radius, no drop-shadow hierarchy.

Three rules guide every decision:

| Rule | Implication |
|------|-------------|
| **Knowledge must stay copyable.** | No opaque bundles, no build steps the reader cannot repeat. |
| **The record matters.** | Every content change goes through the admin panel, which is backed by Supabase, not by committing to `data.js`. |
| **New learners are not exceptions.** | The site must load, degrade gracefully, and explain itself without the database. |

The tech stack follows the same line: **plain HTML, CSS and ES modules**. No framework, no bundler, no transpiler. The only runtime dependencies are Supabase (database, auth, edge functions), highlight.js, KaTeX, Sortable.js, and the Supabase JS client — all vendored or loaded from a CDN the CSP already allows.

---

## 2. Architecture Overview

```
fcs-site/
├── index.html          — Public home page (the RFC document)
├── admin.html          — Admin panel (requires sign-in)
├── blog/               — Static blog output (written by tools/blog-build.mjs)
├── css/
│   ├── style.css       — Main site stylesheet (tokens + sections)
│   ├── admin.css       — Admin panel layout and components
│   └── blog-editor.css — Full-screen Notion-style editor
├── js/
│   ├── config.js       — Supabase URL + anon key (public, safe to commit)
│   ├── data.js         — Seed/fallback data + fixed page copy
│   ├── main.js         — Public page bootstrap + section renders
│   ├── admin.js        — Admin panel: routing, drawers, sections
│   ├── blog-editor.js  — Full-screen block editor
│   ├── supabase.js     — All database calls (one function per operation)
│   ├── render.js       — Shared card/component HTML builders
│   └── lib/            — Pure library modules (markdown, diff, forms, …)
├── tools/              — Node.js build/deploy scripts (.mjs)
├── supabase/
│   ├── schema.sql      — Base schema + RLS + seed data
│   ├── migrations/     — Incremental SQL patches (run in number order)
│   └── functions/      — Deno edge functions (collect, event-mail, …)
└── assets/             — Static assets (SVG icons, fonts, logo, covers)
```

### Request flow — public visitor

```
Browser → index.html
  → js/theme-init.js    (sets theme before paint, no flash)
  → js/page-transitions.js (soft navigation between pages)
  → css/style.css
  → js/config.js        (Supabase credentials)
  → js/data.js          (seed data, in-memory fallback)
  → js/vendor/supabase.min.js
  → js/main.js (module)
      ├── Supabase: reads events, resources, study groups, core members, social links
      ├── GitHub:  reads data/github.json (cached by deploy), falls back to API
      └── Renders each section progressively as data arrives
```

### Request flow — admin editor

```
Browser → admin.html
  → js/theme-init.js
  → js/config.js, js/data.js, js/vendor/supabase.min.js
  → js/vendor/sortable.min.js
  → js/admin.js (module)
      ├── Checks auth session (Supabase Auth)
      ├── Reads profile + role
      ├── Renders sidebar + current section
      └── Opens blog editor (blog-editor.js) for posts
```

---

## 3. Brand & Visual Language

### Colour Tokens

All colours are CSS custom properties resolved from a single `:root` block. A `[data-theme="dark"]` block flips them; no selector outside `:root` changes.

| Token | Light value | Dark value | Purpose |
|-------|-------------|------------|---------|
| `--paper` | `#FFF7E4` (FCS Cream) | `#0f0e0b` | Primary background |
| `--ink` | `#000000` | `#FFF7E4` | Primary text |
| `--accent` | `#FCCE37` (FCS Yellow) | `#FCCE37` | Action fills, highlights |
| `--accent-alert` | `#D12D2D` (FCS Red) | `#D12D2D` | Live events, errors |
| `--slab` | `#000000` | `#FFF7E4` | Inverted panels (nav, stamps) |
| `--slab-ink` | `#FFF7E4` | `#000000` | Text on slab panels |

> [!TIP]
> The five non-colour layout tokens (`--border-w: 3px`, `--shadow-off: 6px`, `--gap`, `--section-pad`, `--page-pad`) use `clamp()` to scale between mobile and wide viewports without breakpoint soup.

### Typography

| Variable | Stack | Use |
|----------|-------|-----|
| `--font-mono` | Archivo Mono → Latin Modern Mono → Fira Code → system monospace | Body text, navigation, headings |
| `--font-display` | Archivo → Archivo Mono → Arial Narrow → system-ui | Hero title only |
| `--font-code` | Latin Modern Mono → Fira Code → Archivo Mono → system monospace | Code blocks |

Blog posts can override with four named fonts: **Default** (Archivo, readable sans), **Mono** (Archivo Mono, the brand voice), **Technical** (Latin Modern Mono, for papers), **Garet** (the brand's digital/social face).

### No-radius Rule

`--radius: 0`. Every border, card, button, and dialog is squared. The only exceptions are small circular avatar images and the toggle handle in the events week strip.

### Theme Toggle

`js/theme-init.js` runs synchronously before any CSS to set `[data-theme]` from `localStorage`, preventing a flash. `js/theme.js` wires the toggle button and persists the choice.

---

## 4. Page Sections

The home page (`index.html`) is structured as an RFC document. Each section gets a two-digit number.

### Document Header

```
Network Working Group   The Free Code Subculture
Last commit             <link to GitHub>
Study groups            Listed below
Discord                 Listed below
Status                  ACTIVE
```

This header is static HTML. The "last commit" value is populated by `js/main.js` from `data/github.json`.

### Sticky Navigation

A `<nav>` with the brand logotype and jump links to each section. On mobile it collapses behind a hamburger button. The active section highlights as the user scrolls (IntersectionObserver). The theme toggle lives here.

### Section Map

| № | ID | Title | Data source |
|---|----|-------|-------------|
| — | hero | Hero / lockup | Static HTML |
| 01 | abstract | Abstract | Static HTML |
| 02 | icarus | The Icarus Mark | Static HTML + `assets/fcs-mark-large.png` |
| 03 | protocol | Operating Protocol | `js/data.js` → `PRINCIPLES[]` |
| 04 | projects | Projects | `data/github.json` → GitHub API fallback |
| 05 | resources | Resources | Supabase `resources` table |
| 06 | study-groups | Study Groups | Supabase `study_groups` table |
| 07 | events | Events | Supabase `events` + `class_sessions` tables |
| 08 | blog | From the Blog | `blog/latest.html` (injected at build) |
| 09 | contribute | Contribution Lanes | `js/data.js` → `CONTRIBUTION_LANES[]` |
| 10 | core | Core Members | Supabase `core_members` table |
| 11 | join | Entry | `js/data.js` join links |

#### Projects Section (04)

Reads `data/github.json` on load; falls back to the GitHub API if the file is missing or more than 3 hours old. Repos can be pinned (shown first), shown under Resources, or hidden via the admin panel's Repositories page. Grouped repos are linked to their study group card.

An **activity ticker** runs across the top of the section, pulled from the latest commit data.

#### Events Section (07)

Three sub-components:

1. **Next-session band** — the soonest upcoming event, with a live countdown (`js/lib/countdown.js`). Shows the next recurring class session when no one-off event is next.
2. **Week strip** — the standing weekly class schedule, one column per active weekday (`js/lib/schedule.js`).
3. **Event list** — all one-off events that are `scheduled` or `live`, filtered by study group. Each card shows the event's computed status (UPCOMING / LIVE / FINISHED / SOON), worked out from `starts_at` and `duration_minutes`, not from the `stage` column.

The **calendar subscribe** menu offers Google Calendar (a URL built from all event dates), Apple/Outlook (a `webcal://` link to `events.ics`), a copy button, and a one-off `.ics` download. The **Email me** button opens a notification dialog (`#notify-dialog`) wired to the `event-mail` edge function.

#### Blog Section (08)

Hidden until `blog/latest.html` exists (a `fetch` at load). The build tool writes the three newest published posts as a `<ul>` of post cards. The section becomes visible once the fragment is injected.

#### Core Members Section (10)

Three groups: **Leads**, **Mentors** (filterable by study group), and **Alumni** (collapsed `<details>`). Each card shows the member's photo (uploaded via admin), GitHub avatar fallback, name, role, study groups, and a grid of platform links.

---

## 5. The Admin Panel

`admin.html` loads `js/admin.js`, which owns routing, auth, the sidebar, the edit drawer, and the toast system.

### Auth Flow

1. Supabase Auth session check on load.
2. If no session → show sign-in form (email + password) with a "Send me a reset link" button.
3. After sign-in → read `profiles` row for `role` (`admin` or `editor`). New accounts start with no role; Realtime (`010_realtime_profiles.sql`) watches the row and re-checks on change, signing them out at once if access is revoked.

### Sidebar Routes

Each sidebar item sets the URL hash (`#/events`, `#/core`, …) and renders a section in `#admin-root`.

| Hash | Section | Who |
|------|---------|-----|
| `#/events` | Events Kanban | editor+ |
| `#/schedule` | Class schedule | editor+ |
| `#/core` | Core members | editor+ |
| `#/study-groups` | Study groups | editor+ |
| `#/resources` | Resources | editor+ |
| `#/social` | Social links | editor+ |
| `#/repos` | Repositories | editor+ |
| `#/blog` | Blog posts | editor+ |
| `#/analytics` | Analytics | editor (if enabled by admin) |
| `#/subscribers` | Email lists | admin only |
| `#/team` | Team & access | admin only |

### Edit Drawer

A single `<aside role="dialog">` slides in from the right when a row is clicked. The drawer:
- Is filled with form fields appropriate to the row type, built dynamically by `js/admin.js`.
- Shows a **live preview** in the right half, drawn by the same render functions as the public page (`js/render.js`).
- Has an **unsaved-changes guard**: closing with edits shows a "Discard / Keep editing" alert.
- Footers: **Save** (creates or updates), **Delete** (second click to confirm, admins only on most tables).

### Toast System

Stacked corner notifications with four tones:

| Tone | Icon | Duration | `role` |
|------|------|----------|--------|
| success | check | 4.2 s | status |
| delete | trash | 4.2 s | status |
| info | circle-info | 5.2 s | status |
| error | square-alert | 8 s | alert |

A progress bar shows time left. Hovering or focusing pauses it. At most three toasts show at once; older ones slide out.

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `/` | Focus search |
| `n` | New item |
| `Escape` | Close drawer |
| `←` / `→` arrows | Navigate Kanban columns (Events) |

### Events Kanban

Events are arranged in four columns: **Draft**, **Scheduled**, **Live**, **Done**. Cards can be dragged between columns (Sortable.js) or moved with arrow buttons. The card shows the event's computed status, not its `stage`.

### Analytics Section

Time-series charts drawn in plain SVG, following the visual language of neobrutalism.dev/charts. Periods: 24 h, 7 d, 30 d, 90 d (compared with the previous equal period).

Metrics: visitors, new visitors, visits, page views, bounce rate, time in view, pages per visit; device breakdown (stacked area), page views or visits by hour/day (bars); referrers, UTM campaigns, top pages, rough regions, named actions (join, copy, email signup, calendar, …), and section dwell time.

---

## 6. The Blog Editor

Clicking a post on the Blog admin section opens `openBlogEditor()` from `js/blog-editor.js` as a **full-screen overlay** (`.nb` div with `role="dialog"`).

### Layout

```
┌─ nb-top ──────────────────────────────────────────────────────────┐
│  ← Posts    Blog / Post title    [Locked] word-count [state]      │
│  [Undo] [Redo]  [Updates] [Preview] [Publish/Update] [⋯]          │
├─ nb-find (Ctrl+F, hidden) ───────────────────────────────────────┤
├─ nb-scroll ──────────────────────────────────────────────────────┤
│  ┌─ nb-cover (optional) ──────────────────────────────────────┐  │
│  │  cover image + reposition / change / remove tools           │  │
│  └────────────────────────────────────────────────────────────┘  │
│  ┌─ nb-page ───────────────────────────────────────────────────┐  │
│  │  [icon button]  [Add icon] [Add cover]                      │  │
│  │  h1.nb-title (contenteditable)                              │  │
│  │  div.nb-props (properties: address, authors, excerpt, …)   │  │
│  │  div.nb-blocks (the editing canvas)                         │  │
│  │  div.nb-attribution (Medium source line)                    │  │
│  └────────────────────────────────────────────────────────────┘  │
├─ nb-preview (Preview pane, hidden until Preview is clicked) ─────┤
└───────────────────────────────────────────────────────────────────┘
┌─ nb-toolbar (floating, shown on text selection) ─────────────────┐
│  [Turn into ▾] | B  i  U  S  </>  √x  🔗 | A▾  ⋯               │
└───────────────────────────────────────────────────────────────────┘
```

### Block Types

#### Basic Blocks

| ID | Name | Markdown shortcut |
|----|------|-------------------|
| `p` | Text | — |
| `h1`–`h4` | Heading 1–4 | `# ` to `#### ` |
| `bullet` | Bulleted list | `- ` |
| `number` | Numbered list | `1. ` |
| `todo` | To-do list | `[] ` |
| `toggle` | Toggle list | `> ` |
| `toggle-h1`–`toggle-h3` | Toggle heading | — |
| `quote` | Quote | `" ` |
| `callout` | Callout | — |
| `divider` | Divider | `---` |
| `table` | Table | — |
| `toc` | Table of contents | — |

#### Layout

| ID | Name |
|----|------|
| `columns-2` | 2 columns |
| `columns-3` | 3 columns |
| `columns-4` | 4 columns |

#### Media

| ID | Name |
|----|------|
| `image` | Image (upload, link, or drag) |
| `video` | YouTube video |
| `bookmark` | Web bookmark card |

#### Advanced / Inline

| ID | Name | Shortcut |
|----|------|----------|
| `code` | Code block | ` ``` ` |
| `math` | Block equation (KaTeX) | `$$` |
| `inline-math` | Inline equation | `$x$` |
| `mention` | Mention a person | `@` |
| `date` | Date mention | `@today` |
| `emoji` | Emoji | `:` |

### Inline Formatting

| Syntax | Result |
|--------|--------|
| `**text**` | **bold** |
| `*text*` | *italic* |
| `++text++` | underline |
| `~~text~~` | ~~strikethrough~~ |
| `==text==` | ==highlight== |
| `` `text` `` | inline code |
| `$text$` | inline KaTeX |
| `^text^` | superscript |
| `~text~` | subscript |
| `[label](https://…)` | link |
| `{color=red}text{/}` | coloured text (Notion palette) |
| `{bg=yellow}text{/}` | highlighted background |
| `@[Name](https://…)` | person mention |
| `@{2026-10-06}` | date mention |

Colours: `gray brown orange yellow green blue purple pink red`.

### Block Interactions

Each block has a **gutter** on the left (appears on hover):

- **`+` button** — adds a new empty text block below; Alt-click adds above.
- **Grip button** — drag to reorder (HTML drag-and-drop); click (or Ctrl+/) opens the block menu.

**Block menu** (searchable):
- Turn into (any text type)
- Block colour, text alignment, list style
- Insert above / below
- Duplicate
- Move up / down
- Copy link to heading (headings only)
- Delete

**Tables** have separate row handles and column handles: insert, duplicate, move, clear, delete; column alignment (left / center / right).

**Images** resize by dragging the right edge. Alignment options: left-floated, centered, right-floated, full-width.

### Properties Panel

Below the title, a row of inline properties (click to expand):

| Property | Stored as |
|----------|-----------|
| URL (slug) | `blog_posts.slug` |
| Authors | `blog_posts.authors` (JSON array: `{id?, name, avatar?, url?}`) |
| Excerpt | `blog_posts.excerpt` |
| Cover credit | `blog_posts.cover_credit` |
| Source URL | `blog_posts.source_url` (read-only after import) |

### Autosave & Versions

- **Draft posts**: autosave fires ~1.5 s after the last keystroke. No manual save needed.
- **Published posts**: edits are autosaved to a separate `blog_drafts` row (migration 029); pressing **Update** commits them and triggers a redeploy.
- **Version history** (migration 029): every manual save of a published post adds a snapshot. The ⋯ menu's "Version history" shows a diff timeline.

### Cover Image

The cover area has three tool modes:

1. **Gallery tab** — a curated set of solid colours, gradients, textures, public-domain astronomy/art images. Built by `tools/build-cover-gallery.mjs`.
2. **Upload tab** — choose, drop, or Ctrl+V paste a file (PNG, JPEG, WebP, up to 2 MB). The panel converts oversized images to WebP before uploading.
3. **Unsplash tab** — searches Unsplash (50 searches/hour free). Photos are hotlinked; photographers are credited automatically.

Covers can be **repositioned** by dragging the image vertically while in "Reposition" mode. The `cover_position` value (0–100) sets `object-position`.

### Icon Picker

Three tabs:
- **Emoji** — full Unicode emoji in Notion's nine groups, rendered with Twemoji for cross-platform consistency. `:rocket` shortcut.
- **Icons** — every pixelarticons icon (`assets/pixel-icons.svg`) in ten brand colours.
- **Upload** — a small square image; previewed on dark and light tiles.

Recent picks are remembered in `localStorage`.

### Post Menu (⋯)

| Option | Description |
|--------|-------------|
| Font | Default / Mono / Technical / Garet |
| Small text | Reduces all block font sizes by ~20% |
| Full width | Removes the max-width cap on the page |
| Lock page | Disables editing (re-click to unlock) |
| Zoom | 75 / 100 / 125 / 150% |
| Copy link | Copies the post's public URL |
| Copy as Markdown | Serialises the current body |
| Import Markdown | Replaces body from a `.md` file |
| Import from Medium | Opens the Medium import dialog |
| Export as Markdown | Downloads `.md` |
| Export as HTML | Downloads `.html` |
| Export as PDF | Print dialog, page already styled for A4/Letter |
| Version history | Opens the diff timeline |
| Duplicate | Creates a new draft with the same content |
| Unpublish | Sets `status` back to `draft`; triggers redeploy |
| Delete | Removes the post entirely (admin only); triggers redeploy |

### Find & Replace (Ctrl+F)

A bar slides in below the top bar. Searches text nodes across all blocks in real time; previous/next navigate matches; "Replace" and "Replace all" work inline. Case-sensitive toggle.

---

## 7. Data Model

Full schema: [`supabase/schema.sql`](../supabase/schema.sql), then each file in [`supabase/migrations/`](../supabase/migrations/) in number order.

### Core Tables

| Table | Purpose |
|-------|---------|
| `profiles` | One row per auth user. `role`: `admin` or `editor` (default no access). |
| `events` | One-off events with `stage` (draft/scheduled/live/done) and `starts_at`. |
| `class_sessions` | Recurring weekly sessions with weekday, time, timezone. |
| `resources` | Curated links: articles, videos, papers, tools. |
| `study_groups` | Named groups each with a colour and optional Discord/GitHub links. |
| `social_links` | Footer links (GitHub, Discord, etc.). |
| `core_members` | Leads and mentors with photo, role, status (active/alumni). |
| `repo_kinds` | Per-repo overrides: show under Projects, Resources, or hide. |
| `blog_posts` | Posts: title, slug, body (Markdown), cover, icon, font, authors (JSON), status. |
| `blog_drafts` | Autosaved edits for published posts (one draft per post). |
| `blog_versions` | Snapshot history for published posts. |
| `activity_log` | Append-only log of all content changes. |
| `analytics_*` | Raw and aggregated analytics rows. |
| `event_subscriptions` | Email signup records (confirmed/pending). |
| `email_sends` | Log of outgoing event-update emails. |

### Row Level Security

- **Anonymous/visitor**: read-only on published, non-hidden rows. No write access at all.
- **Editor**: read all; insert/update on content tables; cannot delete.
- **Admin**: full access including delete, team management, subscribers.
- **Role helper** lives in a `private` schema not exposed by the API.
- **Trigger**: on new `auth.users` row → insert into `profiles` with `role = 'editor'`. New accounts cannot read or write until an admin grants them a role.

---

## 8. Toolchain & Deploy

All tools are plain Node.js ESM scripts in `tools/`. They have no watch mode; each is a one-shot run.

| Script | What it does |
|--------|-------------|
| `blog-build.mjs` | Writes `blog/index.html`, `blog/<slug>/index.html`, `blog/latest.html`, `sitemap.xml` |
| `og.mjs` | Draws 1200×630 OG cards for each post, the blog, and the home page (satori + sharp) |
| `events-feed.mjs` | Writes `events.ics` for calendar subscriptions |
| `github-snapshot.mjs` | Writes `data/github.json` from the GitHub API |
| `link-meta.mjs` | Fetches `<title>`, description, image for bookmark blocks |
| `email-templates.mjs` | Pushes branded email templates to Supabase Auth |
| `build-cover-gallery.mjs` | Builds `assets/cover-gallery.json` and renders cover textures |
| `build-pixel-icons.mjs` | Rebuilds `assets/pixel-icons.svg` from pixelarticons |
| `build-brand-assets.mjs` | Regenerates brand PNGs from SVG sources |
| `shoot.mjs` / `shoot-core.mjs` | Screenshots of public + admin pages for regression checks |
| `verify-page.mjs` / `verify-admin.mjs` / `verify-deeplinks.mjs` | Playwright smoke tests |

### GitHub Actions Deploy

`.github/workflows/pages.yml` runs on every push to `master`, every 30 minutes, and on demand:

1. `npm ci`
2. Run unit tests (`npm test`)
3. `node tools/github-snapshot.mjs` → `data/github.json`
4. `node tools/events-feed.mjs` → `events.ics`
5. `node tools/blog-build.mjs` → `blog/`
6. Publish with the GitHub Pages action

The `refresh-site` edge function triggers step 4–5 when an editor publishes or updates a post, without waiting for the 30-minute schedule.

### Edge Functions

| Function | Trigger | Purpose |
|----------|---------|---------|
| `collect` | POST from `js/track.js` | Stores analytics events |
| `event-mail` | POST from site / admin | Handles email signups + sends |
| `invite-member` | POST from admin | Sends Supabase invite + sets role |
| `medium-import` | POST from editor | Fetches Medium RSS, copies images |
| `refresh-site` | POST from admin | Dispatches GitHub Actions workflow |
| `unsplash` | POST from editor | Proxies Unsplash search (hides API key) |
| `upload-asset` | POST from editor | Commits images to `fcs-assets` repo via GitHub API |

---

## 9. Security Model

| Layer | Mechanism |
|-------|-----------|
| **API access** | Supabase anon key (public, safe to commit). All reads filtered by RLS. No write grants for anon role. |
| **Write access** | Only authenticated users with `editor` or `admin` role, enforced in Postgres RLS. |
| **Admin-only actions** | Delete, team management, subscribers — enforced in RLS and double-checked in edge functions. |
| **Role escalation** | Prevented by RLS: only an admin can change `profiles.role`. The last admin cannot be removed. |
| **Service-role key** | Stays inside edge functions. Never in `js/config.js`. |
| **Content-Security-Policy** | `<meta>` on both pages: scripts only from this site; `connect-src` only to Supabase, GitHub, Discord. |
| **Image uploads** | Only `editor`/`admin`; files are written to a public GitHub repo — never upload private content. |
| **Analytics** | Cookieless; visitor = daily-salted hash of IP+UA; IP never stored; old salts deleted. |
| **Framing** | Admin panel refuses to run inside a frame (`X-Frame-Options` / CSP `frame-ancestors`). |

> [!CAUTION]
> Never put the **service-role key** in `js/config.js`. It would be served to every visitor and would bypass all Row Level Security.

---

## 10. Companion Guides

| Guide | Path | What it covers |
|-------|------|----------------|
| **Sections Guide** | [`docs/Sections.md`](Sections.md) | Each home-page section: markup, JS, Supabase queries, design decisions |
| **Blog Editor Guide** | [`docs/BlogEditor.md`](BlogEditor.md) | Full block reference, keyboard map, autosave, images, Medium import |
| **Admin Panel Guide** | [`docs/AdminPanel.md`](AdminPanel.md) | Each admin section, drawer API, toast system, access model |
| **Data & Schema Guide** | [`docs/DataSchema.md`](DataSchema.md) | Table-by-table reference, RLS policy map, migration history |
| **Deploy & Toolchain Guide** | [`docs/Deploy.md`](Deploy.md) | Build scripts, GitHub Actions, edge functions, Supabase setup |
| **Brand Guide** | [`docs/brand/README.md`](brand/README.md) | Colour palette, typography, logo usage |
