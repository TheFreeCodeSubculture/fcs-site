-- Public member accounts: open signup, email verification, a profile and an
-- optional public directory listing. Admin and editor accounts keep working
-- exactly as before.
--
-- The migration is additive and backward-compatible: the previous release
-- ignores the new columns and table.

-- 1. A member is a normal account with no admin-panel access.
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('admin', 'editor', 'pending', 'member'));

-- 2. Profile and preference fields.
alter table profiles
  add column if not exists email_verified_at  timestamptz,
  add column if not exists directory_opted_in boolean not null default false,
  add column if not exists email_updates      boolean not null default true,
  add column if not exists bio                text,
  add column if not exists website_url        text,
  add column if not exists github_username    text,
  add column if not exists avatar_url         text;

alter table profiles
  drop constraint if exists profiles_bio_length,
  drop constraint if exists profiles_website_url_length,
  drop constraint if exists profiles_avatar_url_length,
  drop constraint if exists profiles_github_username_format;

alter table profiles
  add constraint profiles_bio_length
    check (bio is null or length(bio) <= 1200),
  add constraint profiles_website_url_length
    check (website_url is null or length(website_url) <= 500),
  add constraint profiles_avatar_url_length
    check (avatar_url is null or length(avatar_url) <= 500),
  add constraint profiles_github_username_format
    check (github_username is null or github_username ~ '^[A-Za-z0-9-]{1,39}$');

-- Existing admins and editors already proved control of their address through
-- the old import or an invite. New member accounts start unverified.
update profiles
   set email_verified_at = coalesce(email_verified_at, created_at)
 where role in ('admin', 'editor', 'pending')
   and email_verified_at is null;

-- 3. One-time email-verification tokens. The raw token is never stored.
create table if not exists auth_email_verifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists auth_email_verifications_user_idx
  on auth_email_verifications (user_id, expires_at desc);
