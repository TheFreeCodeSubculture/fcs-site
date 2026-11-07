# FCS Site — Page Sections Guide

Each section of `index.html` is documented here: its HTML structure, the JavaScript that populates it, what it reads from Supabase (or fallback data), and the design decisions behind it.

---

## Document Header

**HTML:** `<header class="doc-header">`

A five-column flex row styled after an IETF RFC memo header block. All five columns are static HTML; the "Last commit" value is filled by `js/main.js` after `data/github.json` is read.

```
Network Working Group   The Free Code Subculture
Last commit             <link to GitHub>
Study groups            Listed below
Discord                 Listed below
Status                  ACTIVE ←link to #events
```

The **Status** value links to `#events` and gets the class `status-active`, which colours it with `--accent`.

---

## Sticky Navigation (`#doc-nav`)

**HTML:** `<nav class="doc-nav" id="doc-nav">`

A horizontal bar that sticks to the top of the viewport (`position: sticky; top: 0`). Contains:

- **Brand logotype** (`a.nav-brand`) — SVG logo + "TFCS" + `/RFC-0001`.
- **Mobile toggle** (`button.nav-toggle`) — hamburger ↔ close, `aria-expanded` wired by `js/main.js`.
- **Link list** (`ul.nav-links`) — seven jump links: About, Projects, Resources, Groups, Events, Blog, Join.
- **Theme toggle** (`button.theme-toggle`) — moon / sun icons; sets `data-theme` on `<html>`.

**Active-section tracking:** `js/main.js` uses an `IntersectionObserver` to watch all `[data-section]` links, adding `is-active` to the link whose section is mid-screen.

---

## Hero Section

**HTML:** `<section class="hero">`

Two-column flex layout:

- **Left — `.hero-art`:** the FCS logo lockup image (`assets/fcs-lockup.png`) over a stamp (`STUDY MUST STAY PUBLIC / NO MASTER / NO LOCK`).
- **Right — `.hero-text`:** kicker, the split `<h1>`, subtitle, two CTA buttons, and a `<dl>` ledger (`rule: freedom first / format: study + work / entry: arrive plainly`).

The `<h1>` is the only use of `--font-display` on the entire page.

---

## Section 01 — Abstract (`#abstract`)

**HTML:** `<section class="doc-section" id="abstract">`

Static HTML. Three-column article grid (`.abstract-grid`) with scope / method / standard cards. No JS, no Supabase.

---

## Section 02 — The Icarus Mark (`#icarus`)

**HTML:** `<section class="doc-section" id="icarus">`

Static HTML. Two-column layout: copy on the left, the mark image (`assets/fcs-mark-large.png`) on the right. No JS, no Supabase.

---

## Section 03 — Operating Protocol (`#protocol`)

**HTML:** `<section class="doc-section" id="protocol">`

**JS:** `js/main.js` populates `#principle-list` from `PRINCIPLES` in `js/data.js`.

```js
// js/data.js
const PRINCIPLES = [
  { title: "Knowledge must stay copyable.", text: "…" },
  { title: "The record matters.", text: "…" },
  // …
];
```

Each principle renders as a `<article>` with a monospace counter, title, and body. Layout: a "protocol plate" on the left (stamped card with the RFC number and the read/write/test/fail/repair/publish ladder) and the principle list on the right.

---

## Section 04 — Projects (`#projects`)

**HTML:** `<section class="doc-section" id="projects">`

**JS:** `js/main.js`, async. Data flows:

1. Fetch `data/github.json` (written by the deploy workflow).
2. If stale (>3 h) or missing, fall back to the GitHub API (`api.github.com/orgs/TheFreeCodeSubculture/repos?type=public&per_page=100`).
3. Apply per-repo overrides from Supabase `repo_kinds` table (show/hide, group link, pin).
4. Render pinned repos first, then the rest, with `js/render.js → coreCardHTML` / repo card HTML.

**Activity ticker (`#activity-ticker`):** a horizontal scrolling strip of the latest commits across all repos, built from `data/github.json`.

**Rate limit:** the site reads `data/github.json` (pre-fetched by the workflow) so the GitHub API limit (60 req/hr unauthenticated) almost never applies. If it does, the section degrades to a link to the org page and a warning.

**Admin integration:** the Repositories page lets editors choose for each repo: **Projects** (default), **Resources** (shows under section 05 instead), or **Hidden**. **Pin to top** brings it to the front. **Link to study group** adds the repo to that group's card.

---

## Section 05 — Resources (`#resources`)

**HTML:** `<section class="doc-section" id="resources">`

**JS:** `js/main.js` reads from Supabase `resources` table, ordered by `sort_order`.

**Data shape:**

```
resources {
  id, title, url, description,
  kind (note|video|paper|course|tool|book|repo),
  group_name, sort_order, is_published
}
```

**Render:** `js/render.js → resourceCardHTML`. Each card shows the kind label, title, description (truncated), and the link icon. Resources with `kind = 'repo'` are repos redirected here from the Repositories page — they render alongside manually-added entries.

**Fallback:** `SEED_RESOURCES` in `js/data.js` (shown when Supabase is unreachable).

---

## Section 06 — Study Groups (`#study-groups`)

**HTML:** `<section class="doc-section" id="study-groups">`

**JS:** `js/main.js` reads from Supabase `study_groups` table.

**Data shape:**

```
study_groups {
  id, name, description, color,
  discord_channel, github_link, sort_order, is_published
}
```

**Render:** `js/render.js → studyGroupCardHTML`. Each card shows the group name in a coloured slab, description, and links. Groups whose repos are linked appear with a repository count badge.

**Fallback:** `SEED_STUDY_GROUPS` in `js/data.js`.

---

## Section 07 — Events (`#events`)

**HTML:** `<section class="doc-section" id="events">`

The most complex section: three distinct sub-components, all driven by `js/main.js` + `js/lib/events-view.js`.

### Sub-component 1: Next-session band (`#next-session`)

Shows the soonest upcoming event or class session with a live countdown (`js/lib/countdown.js`). The band has four `data-mode` states: `loading`, `none`, `event`, `class`. When the countdown reaches zero, it re-reads and may switch to the next item.

### Sub-component 2: Week strip (`#week-strip`)

A horizontal strip with one column per weekday that has an active class session. Built from Supabase `class_sessions`, computed by `js/lib/schedule.js` → `nextOccurrence()`. Clicking a cell opens the event link.

### Sub-component 3: Event list (`#event-list`)

All one-off events with `stage` ≠ `'draft'`, ordered by `starts_at`. Each card's displayed state (UPCOMING / LIVE / FINISHED / SOON) is derived from `starts_at` and `duration_minutes` by `js/lib/derive.js → deriveEventState()`. The `stage` column is an editorial workflow state only.

**Filters:** a row of group-name filter buttons (`#event-filters`). Clicking one filters the event list. Built from the distinct `group_name` values in the returned events.

**Calendar subscribe menu (`#cal-menu`):** builds a Google Calendar URL and a `webcal://` link to `events.ics` on the fly. The download button sends a request to `js/lib/ics.js` for a one-off `.ics`.

**Email notifications:** `button[data-notify="all"]` opens `#notify-dialog`, which calls the `event-mail` edge function.

**Fallback:** `SEED_EVENTS` in `js/data.js`.

---

## Section 08 — From the Blog (`#blog`)

**HTML:** `<section class="doc-section" id="blog" hidden>`

The section starts hidden. On load, `js/main.js` fetches `blog/latest.html`:

```js
const res = await fetch("blog/latest.html");
if (res.ok) {
  const html = await res.text();
  document.getElementById("blog-grid").innerHTML = html;
  blogSection.hidden = false;
  ruleEl.hidden = false;
}
```

`blog/latest.html` is written by `tools/blog-build.mjs` as a `<li>` list of the three most recently published posts. Each is a `postCardHTML` from `js/lib/blog-pages.js`.

If the file does not exist (no posts yet, or running locally without having run the build), the section stays hidden.

---

## Section 09 — Contribution Lanes (`#contribute`)

**HTML:** `<section class="doc-section" id="contribute">`

**JS:** `js/main.js` populates `#lane-grid` from `CONTRIBUTION_LANES` in `js/data.js`. Each lane renders as a card with a label, title, and body text. No Supabase.

A "dispatch" panel at the bottom of the section is static HTML ("Weekly public note").

---

## Section 10 — Core Members (`#core`)

**HTML:** `<section class="doc-section" id="core">`

**JS:** `js/main.js` reads from Supabase `core_members` table.

**Data shape:**

```
core_members {
  id, name, role (lead|mentor|advisor),
  status (active|alumni), github_username,
  photo_url, bio, group_names (array),
  discord_url, linkedin_url, website_url, other_links (json),
  sort_order, is_published
}
```

**Three sub-groups, each in its own `<div>`:**

| Group | Condition | Render |
|-------|-----------|--------|
| Leads | `role = 'lead'` and `status = 'active'` | `coreCardHTML` without study-group badge |
| Mentors | `role = 'mentor'` and `status = 'active'` | `coreCardHTML` with group badge; filterable |
| Alumni | `status = 'alumni'` | Collapsed `<details>` |

**Mentor filters** (`#core-filters`): same button strip as Events filters, built from distinct group names among active mentors.

**Avatar:** `photo_url` from Supabase if set, else `https://github.com/<github_username>.png?size=96`, else initials initials initials from the name.

**Fallback:** `SEED_CORE_MEMBERS` in `js/data.js`.

---

## Section 11 — Entry (`#join`)

**HTML:** `<section class="doc-section" id="join">`

**JS:** `js/main.js` populates `#join-grid` from `JOIN_LINKS` in `js/data.js`. Each entry is a card with a room name, description, and a link. No Supabase.

A side note (`aside.join-note`) shows the Icarus mark again.

---

## Footer

**HTML:** `<footer class="doc-footer">`

Static text (Epictetus quote, distribution notice, colophon, privacy line). Dynamic parts:

- `#footer-socials`: social links from Supabase `social_links` table, rendered by `js/render.js → linkIcon`.
- `#year`: current year.
- `canvas#footer-sky`: the animated particle sky (`js/footer-sky.js`), `aria-hidden`.

**Privacy:** the site is cookieless. Analytics are first-party. The `privacy.html` page explains the data model in plain language.

---

## Global Dialogs

### Notification Dialog (`#notify-dialog`)

A `<dialog>` element that opens when any "Email me" button is clicked. Contains a form with an email field and a honeypot (`#notify-company`). On submit, calls the `event-mail` edge function with the event id (or `'all'`), gets a confirmation email sent, and closes.

### Pixel Field (`canvas#pixel-field`)

Admin-only: an animated pixel art background behind the sign-in form, drawn in `js/admin.js`. Hidden after sign-in.
