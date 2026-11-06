-- Migrasi untuk fitur Autopost Grup Facebook

create table if not exists fb_groups (
  id         text primary key,
  name       text not null,
  url        text not null unique,
  source     text not null default 'manual',
  created_at timestamptz not null default now()
);
create index if not exists fb_groups_created_idx on fb_groups (created_at desc);

create table if not exists post_templates (
  id         text primary key,
  name       text not null,
  body       text not null default '',
  images     jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists post_templates_created_idx on post_templates (created_at desc);

create table if not exists post_runs (
  id           text primary key,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  state        text not null check (state in ('running','paused','done','stopped','error')),
  settings     jsonb not null default '{}'::jsonb,
  dry          boolean not null default true,
  template_ids text[] not null default '{}',
  total        integer not null default 0,
  error        text
);
create index if not exists post_runs_started_idx on post_runs (started_at desc);

create table if not exists post_targets (
  id          text primary key,
  run_id      text not null references post_runs(id) on delete cascade,
  group_id    text not null,
  group_name  text not null,
  group_url   text not null,
  template_id text not null,
  status      text not null check (status in ('pending','posting','success','failed','skipped')),
  message     text,
  post_url    text,
  at          timestamptz
);
create index if not exists post_targets_run_idx on post_targets (run_id);
create index if not exists post_targets_status_idx on post_targets (status);

