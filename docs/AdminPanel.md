# FCS Admin Panel — Guide

The admin panel lives at `admin.html` (locally: `http://localhost:8000/admin.html`; deployed: `/admin`). It is `noindex, nofollow`. The page loads `js/admin.js` as an ES module; everything — routing, auth, sections, the drawer, toasts — lives there.

---

## Table of Contents

1. [Signing In](#1-signing-in)
2. [Access Levels](#2-access-levels)
3. [Sidebar Navigation](#3-sidebar-navigation)
4. [The Edit Drawer](#4-the-edit-drawer)
5. [Toast Notifications](#5-toast-notifications)
6. [Events (Kanban)](#6-events-kanban)
7. [Class Schedule](#7-class-schedule)
8. [Core Members](#8-core-members)
9. [Study Groups](#9-study-groups)
10. [Resources](#10-resources)
11. [Social Links](#11-social-links)
12. [Repositories](#12-repositories)
13. [Blog](#13-blog)
14. [Analytics](#14-analytics)
15. [Subscribers](#15-subscribers)
16. [Team](#16-team)
17. [Keyboard Shortcuts](#17-keyboard-shortcuts)

---

## 1. Signing In

The sign-in screen appears if there is no active Supabase session. It shows:

- **Email** and **password** fields.
- **Sign in** button.
- **Email me a reset link** — sends a password-reset email through Supabase Auth (then to the club Gmail via SMTP).

An animated pixel-field canvas (`canvas#pixel-field`) plays behind the form. It disappears after sign-in.

> [!NOTE]
> New accounts start with **no access** even after signing up. An admin must approve them on the Team page before they can see any content.

---

## 2. Access Levels

| Role | What they can do |
|------|-----------------|
| **No access** (new account) | Sign in; see "Access pending" message. |
| **Editor** | Add and edit all content tables. Cannot delete. Cannot access Subscribers or Team. |
| **Admin** | Full access: delete, Subscribers, Team, analytics on/off for others. |

Role changes take effect immediately via Supabase Realtime (`010_realtime_profiles.sql`): a user signed in with the panel open is signed out at once if their access is removed or set to no access.

The **last admin** cannot be removed (`003_team_roles.sql` enforces this in Postgres).

---

## 3. Sidebar Navigation

A `<nav>` on the left lists one item per section. Each click sets the URL hash (`#/events`, `#/core`, …) and renders the section in `#admin-root`.

```
Events            #/events
Class schedule    #/schedule
Core members      #/core
Study groups      #/study-groups
Resources         #/resources
Social links      #/social
Repositories      #/repos
Blog              #/blog
Analytics         #/analytics      (editors with access only)
─────────────────────────────────
Subscribers       #/subscribers    (admin only)
Team              #/team           (admin only)
```

The active item is highlighted. The sidebar is hidden on the sign-in screen.

---

## 4. The Edit Drawer

A single `<aside role="dialog">` slides in from the right when any row is clicked. It is reused for every section.

### Drawer structure

```
┌── drawer-head ──────────────────────────────────────────────┐
│  h2 (drawer-title)   p (drawer-meta)             [✕ Close] │
└──────────────────────────────────────────────────────────────┘
┌── drawer-body ──────────────────────────────────────────────┐
│  form#drawer-form              │  section.drawer-preview    │
│  (form fields)                 │  (live preview card)       │
└──────────────────────────────────────────────────────────────┘
┌── drawer-confirm (hidden; shown when closing with edits) ───┐
│  "You have unsaved changes." [Discard] [Keep editing]        │
└──────────────────────────────────────────────────────────────┘
┌── drawer-actions ───────────────────────────────────────────┐
│  [Delete]                                    [Cancel] [Save] │
└──────────────────────────────────────────────────────────────┘
```

**Live preview:** the right half of the drawer shows the card as it will appear on the public page, re-rendered on every keystroke. It uses the same `js/render.js` functions as `js/main.js`.

**Unsaved-changes guard:** clicking the backdrop, the ✕ button, or pressing Escape while there are edits shows the confirm row instead of closing immediately.

**Delete:** appears only for admins (and only where the table allows it). The button requires a second click to confirm; the first click changes its label to "Really delete?".

---

## 5. Toast Notifications

Toasts stack in the bottom-right corner (full-width on phones). Each action produces one:

| Tone | Used for | Duration |
|------|---------|---------|
| `success` | Created / updated / saved | 4.2 s |
| `delete` | Deleted | 4.2 s |
| `info` | Informational | 5.2 s |
| `error` | Error | 8 s |

A progress bar shows time remaining. Hovering or focusing a toast pauses it. At most three toasts show at once; older ones are removed. Errors use `role="alert"` (assertive); others use `role="status"`.

---

## 6. Events (Kanban)

**Route:** `#/events`

A four-column Kanban board. Each column is a stage in the editorial workflow:

| Stage | Visible on public site |
|-------|----------------------|
| **Draft** | No |
| **Scheduled** | Yes (shows as UPCOMING when `starts_at` is in the future) |
| **Live** | Yes (shows as LIVE during the event's time slot) |
| **Done** | Yes if `starts_at` is in the past; hidden if still in the future |

> [!IMPORTANT]
> The public page always derives a card's displayed state from `starts_at` and `duration_minutes`, not from `stage`. Moving a card to "Done" hides it only if it is also in the past. A "Scheduled" event that has passed shows as FINISHED automatically.

### Adding an event

Click the **+** button in any column header, or press **n** (adds to Draft).

### Event fields

| Field | Type | Notes |
|-------|------|-------|
| Title | text | Required |
| Group | text | Matches study group names for filtering |
| Details | textarea | Markdown-lite: bold, italic, links |
| Starts at | datetime-local | Stored as UTC in `starts_at` |
| Duration | number (minutes) | Default 60 |
| Link | URL | The event's join or recording link |
| Link text | text | Label for the link button |
| Stage | select | Draft / Scheduled / Live / Done |

### Moving cards

Drag a card to another column (Sortable.js). Arrow buttons on each card also move it one column left or right. The stage is updated immediately in Supabase.

### Reordering within a column

Drag by the row handle, or use the arrow buttons. `sort_order` is updated.

---

## 7. Class Schedule

**Route:** `#/schedule`

The standing weekly recurring sessions. These drive the **week strip** and the **next-session band** on the public page.

### Session fields

| Field | Type | Notes |
|-------|------|-------|
| Title | text | Required |
| Group | text | Used for the week strip column header |
| Weekday | select | Sunday–Saturday (matches `Date.getDay()`) |
| Start time | time | Local to `Timezone` |
| Duration | number (minutes) | Default 60 |
| Timezone | text | Default: `Asia/Kolkata` |
| Link | URL | The recurring meeting link |
| Active | checkbox | Hidden from the site and week strip when off |

---

## 8. Core Members

**Route:** `#/core`

Manages leads, mentors, and alumni.

### Member fields

| Field | Type | Notes |
|-------|------|-------|
| Name | text | Required |
| Role | select | lead / mentor / advisor |
| Status | select | active / alumni |
| GitHub username | text | Used for avatar fallback |
| Photo | image | Uploaded to `fcs-assets`; shown at 96×96 |
| Bio | textarea | Short biography |
| Study groups | multi-select | Links the member to groups for filtering |
| Discord URL | URL | |
| LinkedIn URL | URL | |
| Website URL | URL | |
| Other links | JSON | `[{ label, url }]` |

### Member photos

The **Upload photo** button in the drawer lets editors upload a member's photo directly. Photos are stored in `fcs-assets` via the same upload pipeline as blog images.

`uploadMemberPhoto` in `js/supabase.js` → `upload-asset` edge function.

### Move to alumni

A quick **Move to alumni** button on each active member's drawer sets `status = 'alumni'` without opening all fields.

---

## 9. Study Groups

**Route:** `#/study-groups`

### Group fields

| Field | Type | Notes |
|-------|------|-------|
| Name | text | Required |
| Description | textarea | Shown on the group card |
| Colour | colour-picker | Used as the card's slab background |
| Discord channel URL | URL | |
| GitHub link | URL | |
| Published | checkbox | Hidden from site when off |

Groups are ordered by dragging. The order determines the order of filter buttons on the events section.

---

## 10. Resources

**Route:** `#/resources`

Curated links: articles, videos, papers, tools, books, courses. This is distinct from the **Projects** section (which is live GitHub repos).

### Resource fields

| Field | Type | Notes |
|-------|------|-------|
| Title | text | Required |
| URL | URL | Required |
| Description | textarea | |
| Kind | select | note / video / paper / course / tool / book / repo |
| Group | text | Links to a study group for grouping |
| Published | checkbox | |

Resources with `kind = 'repo'` are repos redirected here from the Repositories page.

---

## 11. Social Links

**Route:** `#/social`

The footer's "Connect" column links and any platform icons used in the site header.

### Link fields

| Field | Type | Notes |
|-------|------|-------|
| Label | text | Shown as the link text |
| Platform | select | discord / github / instagram / x / linkedin / youtube / email / other |
| URL | URL | |
| Published | checkbox | |

---

## 12. Repositories

**Route:** `#/repos`

Lists every public repository in the `TheFreeCodeSubculture` GitHub organisation. Data comes from `data/github.json` (refreshed by the deploy workflow).

For each repo:

| Control | Effect |
|---------|--------|
| **Show under** | Projects (default) / Resources / Hidden |
| **Pin to top** | Pinned repos appear first in the Projects section |
| **Link to study group** | Adds this repo to that group's card |

**Refresh now:** triggers the `refresh-site` edge function, which dispatches a GitHub Actions workflow run. The site is rebuilt in about a minute.

New repos default to **Projects**. Archived repos default to **Hidden**.

---

## 13. Blog

**Route:** `#/blog`

A list of all blog posts, with status badges (Draft / Published) and metadata.

### Post list actions

| Button / action | Description |
|-----------------|-------------|
| **New post** (or `n`) | Opens the blog editor with an empty post |
| **Import from Medium** | Opens the Medium import dialog before creating a new post |
| Click a post row | Opens the full-screen blog editor |

### Blog editor

See [`docs/BlogEditor.md`](BlogEditor.md) for the complete editor reference.

### Post lifecycle

```
New → Draft (autosave) → Published (triggers deploy)
                      ↑
         Update (triggers redeploy)
```

After publish or update, the `refresh-site` edge function dispatches a GitHub Actions workflow. The deploy runs `tools/blog-build.mjs`, which writes `blog/<slug>/index.html` and redraws the OG card. The page is live in about a minute.

---

## 14. Analytics

**Route:** `#/analytics`

Available to admins and editors who have been granted access on the Team page.

### Time periods

24 hours / 7 days / 30 days / 90 days, compared with the previous equal period. Each metric shows a delta (▲ or ▼).

### Metrics

| Metric | Description |
|--------|-------------|
| Visitors | Unique visitor hashes (cookieless daily hash of IP+UA) |
| New visitors | Visitors without the "been here before" localStorage flag |
| Visits | Sessions (gap of >30 min = new visit) |
| Page views | Total page loads |
| Bounce rate | One-page visits lasting <10 s |
| Time in view | Average tab-visible time per visit |
| Pages per visit | Average page views per session |

### Charts

- **Visitors by device** — stacked area (mobile / tablet / desktop), by hour or day
- **Page views or Visits** — bar chart, by hour or day

### Tables

- **Referrers** — where visitors come from
- **UTM campaigns** — visits tagged with `utm_source` / `utm_medium` / `utm_campaign`
- **Top pages** — most-visited pages
- **Actions** — named click events (join, copy link, email signup, calendar, projects link, …)
- **Sections** — which page sections had the most dwell time
- **Regions** — rough location by browser timezone

### Campaign builder

**Analytics → Make a tagged link** builds a URL with `utm_source`, `utm_medium`, and optional `utm_campaign` for sharing on specific platforms (Instagram, WhatsApp, Discord, YouTube, LinkedIn, X, Facebook, Telegram, Reddit, Threads, Snapchat, Pinterest, TikTok, email, QR codes and print).

### How analytics are collected

`js/track.js` runs on public pages only (not in the admin), never on localhost unless `?track=1` is added. It sends small beacons to the `collect` edge function:

- Page view on load
- Visible time (every 30 s and on page unload)
- Named clicks
- Sections visible mid-screen for ≥1 s

No cookies. The visitor identifier is a server-side hash of a **daily random salt + IP + user agent**. The IP is never stored. Old salts are deleted, so visitors cannot be followed across days. Add `?trackdebug=1` to see whether a visit is being counted.

---

## 15. Subscribers

**Route:** `#/subscribers` — **admin only**

Manages email subscriptions for events.

### Lists

- **All events** — anyone who clicked "Email me about events" on the home page
- **Per-event** — anyone who clicked "Email me updates" on a specific event card

Each list shows: email, confirmed/pending, sign-up date.

### Actions

| Action | Description |
|--------|-------------|
| **Add addresses** | Paste a list of emails; they are added as confirmed immediately (no verification email) |
| **Send test** | Sends the update text to the signed-in admin's email |
| **Send update** | Sends a plain-text email to the list; recorded in the activity log |

An "all events" update goes to everyone on any list; an event-specific update goes to that event's list and the all-events list. Each recipient gets one email, with its own one-click unsubscribe link.

**Rate limits:** 100 unconfirmed sign-ups per hour (site-wide); one confirmation email per address per 10 minutes; Gmail allows ~500 emails per day.

---

## 16. Team

**Route:** `#/team` — **admin only**

Lists all accounts in the Supabase `profiles` table.

### Per-account actions

| Action | Who can | Notes |
|--------|---------|-------|
| Set role to Admin / Editor / No access | admin | Takes effect immediately (Realtime) |
| Analytics on/off | admin | Grants or revokes access to `#/analytics` |
| **Remove** | admin | Deletes the auth account entirely; content they created stays; never yourself |
| **Send invite** | admin | Sends a Supabase invite via the `invite-member` edge function |
| **Link member card** | user themselves (or admin for others) | Links their login to a core-member card |

### Invite flow

1. Admin enters the invitee's email and chooses Editor or Admin.
2. The `invite-member` edge function sends a Supabase invite email.
3. The invitee clicks the link, sets a password, and lands back on `admin.html`.
4. They can now sign in with that email and password with the chosen role.

> [!NOTE]
> To prevent anyone from creating accounts without an invite: in Supabase → Authentication → Sign In / Providers → turn off "Allow new users to sign up". Existing accounts are not affected. Use the Team page's Send invite button to invite people from then on.

### Password reset

Users can click "Email me a reset link" on the sign-in screen. Admins can also trigger a reset from the Team page. Both send through the club Gmail SMTP.

---

## 17. Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `/` | Focus the search field in any list |
| `n` | New item (opens empty drawer or blog editor) |
| `Escape` | Close open drawer |
| `←` / `→` | Move event card one stage left/right (while card is focused) |
