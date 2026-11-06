-- Migrasi awal: tabel pekerjaan ulasan, ulasan, pekerjaan lead maps, dan lead maps.

create table if not exists review_jobs (
  id          text primary key,
  market      text not null default 'tokopedia' check (market in ('tokopedia','shopee','lazada')),
  url         text not null,
  title       text not null default '',
  image       text,
  sample      text,
  status      text not null check (status in ('running','done','stopped','error')),
  error       text,
  page        integer not null default 0,
  max_pages   integer not null default 10,
  started_at  timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists review_jobs_market_started_idx on review_jobs (market, started_at desc);

create table if not exists reviews (
  id           bigserial primary key,
  job_id       text not null references review_jobs(id) on delete cascade,
  dedupe_key   text not null,
  name         text not null default '',
  avatar       text not null default '',
  rating       smallint not null default 0 check (rating between 0 and 5),
  date_text    text not null default '',
  variant      text not null default '',
  review       text not null default '',
  images       jsonb not null default '[]'::jsonb,
  seller_reply text not null default '',
  created_at   timestamptz not null default now(),
  unique (job_id, dedupe_key)
);
create index if not exists reviews_job_idx on reviews (job_id, id);
create index if not exists reviews_job_rating_idx on reviews (job_id, rating);

create table if not exists lead_jobs (
  id          text primary key,
  keyword     text not null,
  location    text not null,
  url         text not null,
  fields      text[] not null default '{}',
  max_results integer not null default 50,
  status      text not null check (status in ('running','done','stopped','error')),
  error       text,
  found       integer not null default 0,
  sample      text,
  started_at  timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists lead_jobs_started_idx on lead_jobs (started_at desc);

create table if not exists leads (
  id            bigserial primary key,
  job_id        text not null references lead_jobs(id) on delete cascade,
  dedupe_key    text not null,
  name          text not null default '',
  category      text,
  address       text,
  phone         text,
  website       text,
  rating        numeric(2,1),
  reviews_count integer,
  hours         text,
  lat           double precision,
  lng           double precision,
  maps_url      text,
  status        text,
  created_at    timestamptz not null default now(),
  unique (job_id, dedupe_key)
);
create index if not exists leads_job_idx on leads (job_id, id);

