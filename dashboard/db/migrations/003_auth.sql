-- Migrasi 003: Autentikasi Pengguna & Isolasi Data Multi-Tenant (RLS)

-- 1. Tabel Autentikasi Pengguna & Sesi (di luar RLS)
create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null,
  display_name  text not null default '',
  password_hash text not null,
  disabled      boolean not null default false,
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);
create unique index if not exists users_email_uidx on users (lower(email));

create table if not exists sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  token_hash   text not null unique,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null,
  user_agent   text,
  ip           text
);
create index if not exists sessions_user_idx on sessions (user_id);

create table if not exists auth_attempts (
  id   bigserial primary key,
  key  text not null,
  kind text not null check (kind in ('login','register')),
  ok   boolean not null default false,
  at   timestamptz not null default now()
);
create index if not exists auth_attempts_key_idx on auth_attempts (key, at desc);

-- 2. Modifikasi Tabel Pekerjaan Ulasan & Ulasan
alter table review_jobs add column if not exists user_id uuid references users(id) on delete cascade;
alter table reviews add column if not exists user_id uuid references users(id) on delete cascade;

-- Lepas constraint lama pada reviews dan review_jobs secara aman
alter table reviews drop constraint if exists reviews_job_id_fkey;
alter table reviews drop constraint if exists reviews_job_id_dedupe_key_key;

do $$
begin
  -- Ubah PK review_jobs menjadi komposit (user_id, id)
  if exists (
    select 1 from pg_constraint
    where conrelid = 'review_jobs'::regclass and contype = 'p' and conname = 'review_jobs_pkey'
  ) then
    alter table review_jobs drop constraint review_jobs_pkey;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'review_jobs_pkey') then
    alter table review_jobs add constraint review_jobs_pkey unique (user_id, id);
  end if;

  -- Tambahkan constraint komposit pada reviews
  if not exists (select 1 from pg_constraint where conname = 'reviews_user_job_dedupe_uq') then
    alter table reviews add constraint reviews_user_job_dedupe_uq unique (user_id, job_id, dedupe_key);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'reviews_user_job_fkey') then
    alter table reviews add constraint reviews_user_job_fkey foreign key (user_id, job_id) references review_jobs(user_id, id) on delete cascade;
  end if;
end $$;

create index if not exists review_jobs_user_started_idx on review_jobs (user_id, started_at desc);
create index if not exists reviews_user_job_idx on reviews (user_id, job_id, id);

-- 3. Modifikasi Tabel Lead Maps & Leads
alter table lead_jobs add column if not exists user_id uuid references users(id) on delete cascade;
alter table leads add column if not exists user_id uuid references users(id) on delete cascade;

alter table leads drop constraint if exists leads_job_id_fkey;
alter table leads drop constraint if exists leads_job_id_dedupe_key_key;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'lead_jobs'::regclass and contype = 'p' and conname = 'lead_jobs_pkey'
  ) then
    alter table lead_jobs drop constraint lead_jobs_pkey;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lead_jobs_pkey') then
    alter table lead_jobs add constraint lead_jobs_pkey unique (user_id, id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'leads_user_job_dedupe_uq') then
    alter table leads add constraint leads_user_job_dedupe_uq unique (user_id, job_id, dedupe_key);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'leads_user_job_fkey') then
    alter table leads add constraint leads_user_job_fkey foreign key (user_id, job_id) references lead_jobs(user_id, id) on delete cascade;
  end if;
end $$;

create index if not exists lead_jobs_user_started_idx on lead_jobs (user_id, started_at desc);
create index if not exists leads_user_job_idx on leads (user_id, job_id, id);

-- 4. Modifikasi Tabel Autopost (Grup, Template, Run, Target)
alter table fb_groups add column if not exists user_id uuid references users(id) on delete cascade;
alter table post_templates add column if not exists user_id uuid references users(id) on delete cascade;
alter table post_runs add column if not exists user_id uuid references users(id) on delete cascade;
alter table post_targets add column if not exists user_id uuid references users(id) on delete cascade;

alter table post_targets drop constraint if exists post_targets_run_id_fkey;

do $$
begin
  -- fb_groups
  if exists (
    select 1 from pg_constraint
    where conrelid = 'fb_groups'::regclass and contype = 'p' and conname = 'fb_groups_pkey'
  ) then
    alter table fb_groups drop constraint fb_groups_pkey;
  end if;
  alter table fb_groups drop constraint if exists fb_groups_url_key;

  if not exists (select 1 from pg_constraint where conname = 'fb_groups_pkey') then
    alter table fb_groups add constraint fb_groups_pkey unique (user_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fb_groups_user_url_key') then
    alter table fb_groups add constraint fb_groups_user_url_key unique (user_id, url);
  end if;

  -- post_templates
  if exists (
    select 1 from pg_constraint
    where conrelid = 'post_templates'::regclass and contype = 'p' and conname = 'post_templates_pkey'
  ) then
    alter table post_templates drop constraint post_templates_pkey;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'post_templates_pkey') then
    alter table post_templates add constraint post_templates_pkey unique (user_id, id);
  end if;

  -- post_runs
  if exists (
    select 1 from pg_constraint
    where conrelid = 'post_runs'::regclass and contype = 'p' and conname = 'post_runs_pkey'
  ) then
    alter table post_runs drop constraint post_runs_pkey;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'post_runs_pkey') then
    alter table post_runs add constraint post_runs_pkey unique (user_id, id);
  end if;

  -- post_targets
  if exists (
    select 1 from pg_constraint
    where conrelid = 'post_targets'::regclass and contype = 'p' and conname = 'post_targets_pkey'
  ) then
    alter table post_targets drop constraint post_targets_pkey;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'post_targets_pkey') then
    alter table post_targets add constraint post_targets_pkey unique (user_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'post_targets_user_run_fkey') then
    alter table post_targets add constraint post_targets_user_run_fkey foreign key (user_id, run_id) references post_runs(user_id, id) on delete cascade;
  end if;
end $$;

create index if not exists fb_groups_user_created_idx on fb_groups (user_id, created_at desc);
create index if not exists post_templates_user_created_idx on post_templates (user_id, created_at desc);
create index if not exists post_runs_user_started_idx on post_runs (user_id, started_at desc);
create index if not exists post_targets_user_run_idx on post_targets (user_id, run_id);

-- 5. Kebijakan Row-Level Security (RLS) pada Seluruh Tabel Data Pengguna
alter table review_jobs enable row level security;
alter table review_jobs force row level security;
drop policy if exists tenant_isolation on review_jobs;
create policy tenant_isolation on review_jobs
  using      (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  with check (user_id = nullif(current_setting('app.user_id', true), '')::uuid);

alter table reviews enable row level security;
alter table reviews force row level security;
drop policy if exists tenant_isolation on reviews;
create policy tenant_isolation on reviews
  using      (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  with check (user_id = nullif(current_setting('app.user_id', true), '')::uuid);

alter table lead_jobs enable row level security;
alter table lead_jobs force row level security;
drop policy if exists tenant_isolation on lead_jobs;
create policy tenant_isolation on lead_jobs
  using      (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  with check (user_id = nullif(current_setting('app.user_id', true), '')::uuid);

alter table leads enable row level security;
alter table leads force row level security;
drop policy if exists tenant_isolation on leads;
create policy tenant_isolation on leads
  using      (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  with check (user_id = nullif(current_setting('app.user_id', true), '')::uuid);

alter table fb_groups enable row level security;
alter table fb_groups force row level security;
drop policy if exists tenant_isolation on fb_groups;
create policy tenant_isolation on fb_groups
  using      (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  with check (user_id = nullif(current_setting('app.user_id', true), '')::uuid);

alter table post_templates enable row level security;
alter table post_templates force row level security;
drop policy if exists tenant_isolation on post_templates;
create policy tenant_isolation on post_templates
  using      (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  with check (user_id = nullif(current_setting('app.user_id', true), '')::uuid);

alter table post_runs enable row level security;
alter table post_runs force row level security;
drop policy if exists tenant_isolation on post_runs;
create policy tenant_isolation on post_runs
  using      (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  with check (user_id = nullif(current_setting('app.user_id', true), '')::uuid);

alter table post_targets enable row level security;
alter table post_targets force row level security;
drop policy if exists tenant_isolation on post_targets;
create policy tenant_isolation on post_targets
  using      (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  with check (user_id = nullif(current_setting('app.user_id', true), '')::uuid);

