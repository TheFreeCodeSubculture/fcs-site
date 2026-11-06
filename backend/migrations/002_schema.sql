-- Core content, auth and analytics tables for the FCS backend.
-- This is the application's own schema; the previous hosted database's
-- row-level security is replaced by route-level authorization.

create extension if not exists pgcrypto;

-- ------------------------------------------------------------------ people
create table if not exists core_members (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  role            text not null default 'mentor' check (role in ('lead','mentor')),
  title           text,
  status          text not null default 'active' check (status in ('active','alumni')),
  group_name      text,
  focus           text[] not null default '{}' check (cardinality(focus) <= 4),
  bio             text check (char_length(bio) <= 280),
  github_username text unique,
  photo_url       text check (photo_url ~* '^https?://'),
  photo_thumb_url text check (photo_thumb_url ~* '^https?://'),
  linkedin_url    text check (linkedin_url ~* '^https?://'),
  instagram_url   text check (instagram_url ~* '^https?://'),
  x_url           text check (x_url ~* '^https?://'),
  website_url     text check (website_url ~* '^https?://'),
  email           text check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  discord_handle  text,
  joined_on       date,
  ended_on        date,
  sort_order      integer not null default 0,
  is_published    boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists profiles (
  id                 uuid primary key default gen_random_uuid(),
  email              text not null,
  password_hash      text,
  display_name       text,
  role               text not null default 'pending' check (role in ('admin','editor','pending')),
  can_view_analytics boolean not null default false,
  core_member_id     uuid unique references core_members(id) on delete set null,
  must_reset         boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index if not exists profiles_email_unique on profiles (lower(email));

create table if not exists auth_refresh_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  token_hash  text not null unique,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz
);
create index if not exists auth_refresh_tokens_user_idx on auth_refresh_tokens (user_id, expires_at desc);

create table if not exists auth_password_resets (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists auth_password_resets_user_idx on auth_password_resets (user_id, expires_at desc);

create table if not exists auth_invites (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  role        text not null default 'editor' check (role in ('admin','editor')),
  token_hash  text not null unique,
  invited_by  uuid references profiles(id) on delete set null,
  expires_at  timestamptz not null,
  accepted_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists auth_invites_email_idx on auth_invites (lower(email), expires_at desc);

-- ------------------------------------------------------------------ events
create table if not exists events (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  group_name       text,
  details          text,
  starts_at        timestamptz not null,
  duration_minutes integer not null default 60,
  stage            text not null default 'draft' check (stage in ('draft','scheduled','live','done')),
  link             text,
  link_text        text,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists events_starts_at_idx on events (starts_at);
create index if not exists events_stage_idx on events (stage);

create table if not exists class_sessions (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  group_name       text,
  weekday          integer not null check (weekday between 0 and 6),
  start_time       time not null,
  duration_minutes integer not null default 60,
  timezone         text not null default 'Asia/Kolkata',
  link             text,
  is_active        boolean not null default true,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- --------------------------------------------------------------- resources
create table if not exists resources (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  kind         text not null default 'notes' check (kind in ('notes','video','paper','course','tool','book')),
  url          text not null,
  summary      text,
  group_name   text,
  sort_order   integer not null default 0,
  is_published boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists study_groups (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  topic        text not null,
  status       text not null default 'Forming' check (status in ('Active','Forming','Paused','Completed')),
  link         text,
  link_text    text,
  sort_order   integer not null default 0,
  is_published boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists social_links (
  id           uuid primary key default gen_random_uuid(),
  platform     text not null default 'web' check (platform in ('discord','instagram','whatsapp','github','x','web','other')),
  label        text not null,
  url          text not null,
  hint         text,
  sort_order   integer not null default 0,
  is_published boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists repo_kinds (
  repo_name  text primary key,
  kind       text not null default 'project' check (kind in ('project','resource','hidden')),
  note       text,
  pinned     boolean not null default false,
  sort_order integer not null default 0,
  group_id   uuid references study_groups(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists repo_kinds_group_idx on repo_kinds (group_id);

-- -------------------------------------------------------------------- blog
create table if not exists blog_posts (
  id             uuid primary key default gen_random_uuid(),
  title          text not null check (length(title) between 1 and 160),
  slug           text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 80),
  excerpt        text check (length(excerpt) <= 300),
  body           text not null default '' check (length(body) <= 200000),
  cover_url      text check (cover_url ~* '^https://\S+$'),
  cover_credit   jsonb check (
    cover_credit is null or (
      jsonb_typeof(cover_credit) = 'object'
      and length(cover_credit ->> 'name') between 1 and 120
      and (cover_credit ->> 'url') ~* '^https://unsplash\.com/\S+$'
    )
  ),
  author_name    text check (length(author_name) <= 80),
  authors        jsonb not null default '[]'::jsonb check (
    jsonb_typeof(authors) = 'array' and jsonb_array_length(authors) <= 12
  ),
  status         text not null default 'draft' check (status in ('draft','published')),
  published_at   timestamptz,
  icon           text check (
    icon is null or (
      length(icon) <= 500 and (
        icon ~ '^icon:[a-z0-9-]+(:[a-z]+)?$'
        or icon ~* '^https://\S+$'
        or length(icon) <= 16
      )
    )
  ),
  cover_position smallint not null default 50 check (cover_position between 0 and 100),
  font           text not null default 'default' check (font in ('default','mono','technical','garet')),
  small_text     boolean not null default false,
  full_width     boolean not null default false,
  locked         boolean not null default false,
  source_url     text check (source_url is null or source_url ~* '^https://\S+$'),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists blog_posts_published_idx
  on blog_posts (published_at desc) where status = 'published';

create table if not exists blog_drafts (
  post_id    uuid primary key references blog_posts(id) on delete cascade,
  content    jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id) on delete set null
);

create table if not exists blog_versions (
  id         bigint generated always as identity primary key,
  post_id    uuid not null references blog_posts(id) on delete cascade,
  content    jsonb not null,
  kind       text not null default 'edit' check (kind in ('edit','publish')),
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id) on delete set null
);
create index if not exists blog_versions_post_idx on blog_versions (post_id, created_at desc);

-- ---------------------------------------------------------------- activity
create table if not exists activity_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor_id    uuid,
  actor_email text,
  action      text not null check (action in ('create','update','delete','restore')),
  table_name  text not null,
  row_id      text not null,
  row_label   text,
  changed     text[] not null default '{}',
  snapshot    jsonb
);
create index if not exists activity_log_row_idx on activity_log (table_name, row_id, at desc);
create index if not exists activity_log_at_idx on activity_log (at desc);

-- ------------------------------------------------------------ email lists
create table if not exists subscriptions (
  id           uuid primary key default gen_random_uuid(),
  email        text not null check (length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  event_id     uuid references events(id) on delete cascade,
  token        uuid not null unique default gen_random_uuid(),
  confirmed_at timestamptz,
  added_by     uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint subscriptions_email_list unique nulls not distinct (email, event_id)
);
create index if not exists subscriptions_event_idx on subscriptions (event_id);
create index if not exists subscriptions_email_idx on subscriptions (email);

create table if not exists email_sends (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  body          text not null,
  event_id      uuid references events(id) on delete set null,
  sent_by_email text,
  recipients    integer not null default 0,
  failed        integer not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists email_sends_event_idx on email_sends (event_id);

-- --------------------------------------------------------------- analytics
create table if not exists analytics_pageviews (
  id            bigint generated always as identity primary key,
  at            timestamptz not null default now(),
  view_key      uuid not null unique,
  path          text not null,
  referrer_host text,
  utm_source    text,
  utm_medium    text,
  utm_campaign  text,
  visitor       text not null,
  session       text not null,
  is_new        boolean not null default false,
  device        text,
  timezone      text,
  country       text,
  engaged_ms    integer not null default 0
);
create index if not exists analytics_pageviews_at_idx on analytics_pageviews (at);

create table if not exists analytics_events (
  id      bigint generated always as identity primary key,
  at      timestamptz not null default now(),
  name    text not null,
  label   text,
  path    text,
  visitor text not null,
  session text not null
);
create index if not exists analytics_events_at_idx on analytics_events (at);

create table if not exists analytics_salts (
  day  date primary key,
  salt text not null default encode(gen_random_bytes(32), 'hex')
);

-- --------------------------------------------------------------- triggers
create or replace function touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function stamp_published_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'published' and new.published_at is null then
    new.published_at = now();
  end if;
  return new;
end;
$$;

create or replace function log_activity()
returns trigger
language plpgsql
as $$
declare
  rec     jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  prev    jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  key     text  := coalesce(rec ->> 'id', rec ->> 'repo_name');
  label   text  := coalesce(rec ->> 'title', rec ->> 'name', rec ->> 'label',
                            rec ->> 'repo_name', rec ->> 'email');
  cols    text[] := '{}';
  act     text;
  actor   uuid  := nullif(current_setting('app.actor_id', true), '')::uuid;
  email   text  := nullif(current_setting('app.actor_email', true), '');
begin
  if tg_op = 'UPDATE' then
    select coalesce(array_agg(n.k order by n.k), '{}') into cols
    from jsonb_each(rec) as n(k, v)
    where n.k not in ('updated_at', 'created_at', 'sort_order', 'password_hash', 'must_reset')
      and n.v is distinct from prev -> n.k;
    if cardinality(cols) = 0 then
      return null;
    end if;
    act := 'update';
  elsif tg_op = 'INSERT' then
    act := case when exists (
      select 1 from activity_log l
      where l.table_name = tg_table_name and l.row_id = key and l.action = 'delete'
    ) then 'restore' else 'create' end;
  else
    act := 'delete';
  end if;

  insert into activity_log
    (actor_id, actor_email, action, table_name, row_id, row_label, changed, snapshot)
  values
    (actor, email, act, tg_table_name, key, label, cols,
     case when tg_op = 'DELETE' then rec end);
  return null;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'events', 'class_sessions', 'resources', 'study_groups', 'social_links',
    'core_members', 'repo_kinds', 'blog_posts', 'email_sends'
  ]
  loop
    execute format('drop trigger if exists touch_updated_at on %I', t);
    execute format(
      'create trigger touch_updated_at before update on %I
         for each row execute function touch_updated_at()', t
    );
    execute format('drop trigger if exists log_activity on %I', t);
    execute format(
      'create trigger log_activity after insert or update or delete on %I
         for each row execute function log_activity()', t
    );
  end loop;
end $$;

drop trigger if exists touch_updated_at on profiles;
create trigger touch_updated_at before update on profiles
  for each row execute function touch_updated_at();

drop trigger if exists stamp_published_at on blog_posts;
create trigger stamp_published_at before insert or update on blog_posts
  for each row execute function stamp_published_at();
