-- Metadata used by the backend. The full content schema is added next.
create table if not exists app_meta (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

insert into app_meta (key, value)
values ('schema', 'bootstrap')
on conflict (key) do nothing;
