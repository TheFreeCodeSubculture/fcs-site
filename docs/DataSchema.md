# FCS Data & Schema Guide

This guide documents every Supabase table, its columns, the Row Level Security policies, and the migration history. Run `supabase/schema.sql` first, then each file in `supabase/migrations/` in numerical order.

---

## Table of Contents

1. [How to Set Up](#1-how-to-set-up)
2. [Core Tables](#2-core-tables)
3. [Blog Tables](#3-blog-tables)
4. [Analytics Tables](#4-analytics-tables)
5. [Email Subscription Tables](#5-email-subscription-tables)
6. [Row Level Security Summary](#6-row-level-security-summary)
7. [Migration History](#7-migration-history)
8. [Fallback / Seed Data](#8-fallback--seed-data)

---

## 1. How to Set Up

1. Create a free project at [supabase.com](https://supabase.com).
2. Open **SQL Editor → New query**.
3. Paste and run `supabase/schema.sql`. It is idempotent: re-running does not duplicate or destroy data.
4. Run each file in `supabase/migrations/` in number order (`002_core_members.sql` → `003_team_roles.sql` → … → latest). Each is also idempotent.
5. Paste the project URL and anon key into `js/config.js`.
6. Create your account under **Authentication → Users**, then promote yourself to admin:
   ```sql
   UPDATE public.profiles SET role = 'admin' WHERE email = 'you@example.com';
   ```

> [!IMPORTANT]
> The anon key in `js/config.js` is public by design. **Never put the service-role key there.** It would bypass all Row Level Security and be readable by every visitor.

---

## 2. Core Tables

### `profiles`

Auto-created on new signup by a trigger at the bottom of `schema.sql`.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | References `auth.users(id)` ON DELETE CASCADE |
| `email` | text | |
| `display_name` | text | |
| `role` | text | `'admin'` or `'editor'`; default `'editor'` (no access until promoted) |
| `created_at` | timestamptz | |

**RLS:** An admin can read and update all profiles. An editor can read and update their own. New accounts have no grants until an admin sets their role.

---

### `events`

One-off events (the Kanban cards).

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `title` | text NOT NULL | |
| `group_name` | text | Matches study group names for filtering |
| `details` | text | Markdown-lite |
| `starts_at` | timestamptz NOT NULL | The single source of truth for timing |
| `duration_minutes` | integer | Default 60 |
| `stage` | text | `'draft'` / `'scheduled'` / `'live'` / `'done'` |
| `link` | text | Join or recording URL |
| `link_text` | text | Label for the link |
| `sort_order` | integer | Within-column ordering |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

**Indexes:** `events_starts_at_idx`, `events_stage_idx`.

**Public visibility:** rows where `stage IN ('scheduled', 'live', 'done')` are readable by anonymous visitors (`004_hide_unpublished.sql`).

> [!NOTE]
> The public page derives each event's display state (UPCOMING / LIVE / FINISHED / SOON) from `starts_at` and `duration_minutes`, not from `stage`. `stage` is a workflow state only.

---

### `class_sessions`

Standing weekly recurring sessions (the week strip).

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `title` | text NOT NULL | |
| `group_name` | text | |
| `weekday` | integer | 0 = Sunday … 6 = Saturday (matches `Date.getDay()`) |
| `start_time` | time | Local to `timezone` |
| `duration_minutes` | integer | Default 60 |
| `timezone` | text | Default `'Asia/Kolkata'` |
| `link` | text | |
| `is_active` | boolean | Hidden when false |
| `sort_order` | integer | |
| `created_at` / `updated_at` | timestamptz | |

**Public visibility:** rows where `is_active = true`.

---

### `resources`

Curated learning links.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `title` | text NOT NULL | |
| `url` | text | |
| `description` | text | |
| `kind` | text | `'note'` / `'video'` / `'paper'` / `'course'` / `'tool'` / `'book'` / `'repo'` |
| `group_name` | text | |
| `sort_order` | integer | |
| `is_published` | boolean | |
| `created_at` / `updated_at` | timestamptz | |

---

### `study_groups`

Named study groups, each with a colour and optional links.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `name` | text NOT NULL | |
| `description` | text | |
| `color` | text | CSS colour (hex or named) |
| `discord_channel` | text | URL |
| `github_link` | text | URL |
| `sort_order` | integer | |
| `is_published` | boolean | |
| `created_at` / `updated_at` | timestamptz | |

---

### `social_links`

Footer Connect column links.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `label` | text | |
| `platform` | text | `'discord'` / `'github'` / `'instagram'` / `'x'` / `'linkedin'` / `'youtube'` / `'email'` / `'other'` |
| `url` | text | |
| `is_published` | boolean | |
| `sort_order` | integer | |
| `created_at` / `updated_at` | timestamptz | |

---

### `core_members`

Leads, mentors, and alumni (migration `002`).

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `name` | text NOT NULL | |
| `role` | text | `'lead'` / `'mentor'` / `'advisor'` |
| `status` | text | `'active'` / `'alumni'` |
| `github_username` | text | Used for avatar fallback |
| `photo_url` | text | URL to uploaded photo |
| `bio` | text | |
| `group_names` | text[] | Array of study group names |
| `discord_url` / `linkedin_url` / `website_url` | text | |
| `other_links` | jsonb | `[{ label, url }]` |
| `sort_order` | integer | |
| `is_published` | boolean | |
| `created_at` / `updated_at` | timestamptz | |
| `member_link` | uuid | FK to `profiles.id`; links a login to a card (migration `028`) |

**Public visibility:** rows where `is_published = true`.

---

### `repo_kinds`

Per-repository display overrides. One row per repo that has been configured.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `github_id` | integer UNIQUE | GitHub's numeric repo ID |
| `kind` | text | `'projects'` / `'resources'` / `'hidden'` |
| `is_pinned` | boolean | Pin to top of Projects |
| `group_name` | text | Link to a study group |
| `repo_groups` | jsonb | Named groups of repos (migration `015`) |
| `created_at` / `updated_at` | timestamptz | |

---

## 3. Blog Tables

Added by migrations `022`–`033`.

### `blog_posts` (migration `022`)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `title` | text | |
| `slug` | text UNIQUE | URL path: `blog/<slug>/` |
| `body` | text | Full Markdown content |
| `excerpt` | text | For post cards and OG description |
| `cover_url` | text | |
| `cover_position` | integer | 0–100; `object-position` offset |
| `cover_credit` | text | Unsplash credit (migration `032`) |
| `icon` | text | Emoji char, `icon:<name>:<color>`, or upload URL |
| `font` | text | `'default'` / `'mono'` / `'technical'` / `'garet'` |
| `small_text` | boolean | |
| `full_width` | boolean | |
| `locked` | boolean | Prevents editing |
| `source_url` | text | Medium original URL (migration `033`) |
| `authors` | jsonb | `[{ id?, name, avatar?, url? }]` |
| `author_name` | text | Legacy single-author string |
| `status` | text | `'draft'` / `'published'` |
| `published_at` | timestamptz | |
| `updated_at` | timestamptz | |
| `created_at` | timestamptz | |

**Public visibility:** rows where `status = 'published'`.

---

### `blog_drafts` (migration `029`)

Autosaved edits for a published post. One row per post.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `post_id` | uuid FK → `blog_posts.id` | |
| `content` | jsonb | Snapshot of editable fields |
| `updated_at` | timestamptz | |

**RLS:** readable and writable only by editors/admins. Not readable by anonymous visitors.

---

### `blog_versions` (migration `029`)

Snapshot history. One row per manual save of a published post.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `post_id` | uuid FK → `blog_posts.id` | |
| `content` | jsonb | Snapshot at time of save |
| `kind` | text | `'manual'` / `'publish'` / `'update'` |
| `created_at` | timestamptz | |

---

## 4. Analytics Tables

Added by migrations `016`–`021`.

### `analytics_events`

Raw event log. Each beacon from `js/track.js` inserts one or more rows.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `visitor` | text | Daily-salted hash (never the IP itself) |
| `session` | text | Session identifier |
| `page` | text | Pathname |
| `event` | text | `'view'` / `'time'` / `'click'` / `'section'` |
| `value` | integer | Seconds (time event) or 1 (view) |
| `name` | text | Named action for click / section events |
| `referrer` | text | |
| `utm_source` / `utm_medium` / `utm_campaign` | text | |
| `device` | text | `'mobile'` / `'tablet'` / `'desktop'` |
| `region` | text | Timezone-derived rough location |
| `is_new` | boolean | First visit (from localStorage flag) |
| `created_at` | timestamptz | |

**Rows older than 13 months are deleted nightly** (`pg_cron`).

**RLS:** writable by anonymous visitors (insert only via the `collect` edge function); readable only by admins/editors with analytics access.

---

### `analytics_daily` / `analytics_sessions`

Pre-aggregated summaries used by the analytics charts. Populated by DB functions called by `analytics_report()`.

---

## 5. Email Subscription Tables

Added by migration `011`.

### `event_subscriptions`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `email` | text | |
| `event_id` | uuid | null = "all events" |
| `confirmed` | boolean | false = pending confirmation |
| `token` | text | One-time confirmation token |
| `created_at` | timestamptz | |
| `unsubscribe_token` | text | For one-click unsubscribe links |

**Rate limits enforced by RLS + edge function:** 100 unconfirmed per hour site-wide; 1 confirmation email per address per 10 minutes.

**RLS:** anonymous visitors can insert (sign up); only admins can read.

---

### `email_sends`

Log of outgoing email campaigns.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `sent_by` | uuid FK → `profiles.id` | |
| `event_id` | uuid | null = "all events" |
| `subject` | text | |
| `body` | text | |
| `recipient_count` | integer | |
| `created_at` | timestamptz | |

**RLS:** readable and writable only by admins.

---

## 6. Row Level Security Summary

| Table | Anonymous (visitor) | Editor | Admin |
|-------|---------------------|--------|-------|
| `profiles` | — | read own, update own | read all, update all |
| `events` | read published | read all, insert, update | + delete |
| `class_sessions` | read active | read all, insert, update | + delete |
| `resources` | read published | read all, insert, update | + delete |
| `study_groups` | read published | read all, insert, update | + delete |
| `social_links` | read published | read all, insert, update | + delete |
| `core_members` | read published | read all, insert, update | + delete |
| `repo_kinds` | read | read, insert, update | + delete |
| `blog_posts` | read published | read all, insert, update | + delete |
| `blog_drafts` | — | read own, insert, update | read all |
| `blog_versions` | — | read, insert | read all |
| `analytics_events` | insert only | — | read (if access granted) |
| `event_subscriptions` | insert only | — | read all |
| `email_sends` | — | — | read, insert |

The **role helper function** lives in a `private` schema that the API does not expose. Trigger functions cannot be called over RPC (`005_advisor_fixes.sql`).

---

## 7. Migration History

| File | What it adds |
|------|-------------|
| `schema.sql` | Core tables: profiles, events, class_sessions, resources, study_groups, social_links; RLS; seed data; signup trigger |
| `002_core_members.sql` | `core_members` table |
| `003_team_roles.sql` | Role-change and last-admin-protection policies |
| `004_hide_unpublished.sql` | Anonymous read filter: published/active rows only |
| `005_advisor_fixes.sql` | Private schema; prevent RPC of trigger functions |
| `006_activity_log.sql` | `activity_log` append-only table |
| `007_member_photos.sql` | `photo_url` column on `core_members` |
| `008_service_role_profiles.sql` | Service-role grants for the `invite-member` edge function |
| `009_remove_member.sql` | `removeMember()` function (admin-only, never yourself) |
| `010_realtime_profiles.sql` | Realtime publication on `profiles` (live sign-out on role change) |
| `011_event_subscriptions.sql` | `event_subscriptions` + `email_sends` tables |
| `012_service_role_events.sql` | Service-role grants for the `event-mail` edge function |
| `013_other_links.sql` | `other_links` jsonb on `core_members` |
| `014_hidden_repos.sql` | `repo_kinds` table |
| `015_repo_pins_and_groups.sql` | `is_pinned`, `group_name`, `repo_groups` on `repo_kinds` |
| `016_analytics.sql` | `analytics_events` table + `collect` edge function grants |
| `017_analytics_sections.sql` | Section dwell-time tracking |
| `018_analytics_timezone.sql` | `region` column (timezone-derived) |
| `019_analytics_series_by_device.sql` | Device breakdown in analytics |
| `020_analytics_country.sql` | Country-level rollup |
| `021_realtime_analytics.sql` | Realtime publication on analytics tables |
| `022_blog_posts.sql` | `blog_posts` table |
| `023_blog_page_look.sql` | `font`, `small_text`, `full_width` columns |
| `024_blog_icon_colors.sql` | Pixel icon + colour storage in `icon` column |
| `025_blog_page_style.sql` | `locked` column |
| `026_blog_font_garet.sql` | `'garet'` added to font enum |
| `027_blog_authors.sql` | `authors` jsonb column |
| `028_profile_member_link.sql` | `member_link` FK on `core_members` → `profiles` |
| `029_blog_drafts_versions.sql` | `blog_drafts` + `blog_versions` tables |
| `030_blog_drafts_grants.sql` | RLS grants for draft tables |
| `031_blog_post_analytics.sql` | Per-post analytics function |
| `032_blog_cover_credit.sql` | `cover_credit` column (Unsplash attribution) |
| `033_blog_source_url.sql` | `source_url` column (Medium provenance) |

---

## 8. Fallback / Seed Data

`js/data.js` contains two categories of data:

### Fixed page copy (never overridden by Supabase)

- `PRINCIPLES` — the four operating protocol principles (Section 03)
- `CONTRIBUTION_LANES` — the four contribution lanes (Section 09)
- `JOIN_LINKS` — the entry room links (Section 11)

These are part of the site's editorial voice and are not managed in the admin panel.

### Fallback arrays (shown when Supabase is unreachable)

| Constant | Supabase table |
|----------|----------------|
| `SEED_CORE_MEMBERS` | `core_members` |
| `SEED_EVENTS` | `events` |
| `SEED_STUDY_GROUPS` | `study_groups` |
| `SEED_RESOURCES` | `resources` |
| `SEED_SOCIAL_LINKS` | `social_links` |

> [!NOTE]
> Edit all content in the **admin panel**, not in `js/data.js`. The `SEED_*` arrays are shown only when the database is unreachable or the Supabase project is paused. They will show stale data if the database has been updated and the seed arrays have not.

The Supabase free tier pauses after a period of inactivity. Reactivate it from the Supabase dashboard; the site will show fallback seed data in the meantime.
