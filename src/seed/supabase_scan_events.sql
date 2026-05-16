create table if not exists public.scan_events (
  event_id text primary key,
  type text,
  category text,
  priority text,
  status text,
  city text,
  area text,
  area_lat double precision,
  area_lng double precision,
  lat double precision,
  lng double precision,
  address text,
  event_tags text[],
  source_trail text[],
  road_coords jsonb,
  ai_summary text,
  scan_datetime timestamptz,
  news_date timestamptz,
  raw_input text,
  mission_context text,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists scan_events_updated_at_idx on public.scan_events (updated_at desc);
create index if not exists scan_events_city_area_idx on public.scan_events (city, area);
create index if not exists scan_events_scan_datetime_idx on public.scan_events (scan_datetime desc);
create index if not exists scan_events_news_date_idx on public.scan_events (news_date desc);

alter table public.scan_events add column if not exists event_tags text[];
alter table public.scan_events add column if not exists source_trail text[];
alter table public.scan_events add column if not exists road_coords jsonb;
alter table public.scan_events add column if not exists ai_summary text;
alter table public.scan_events add column if not exists scan_datetime timestamptz;
alter table public.scan_events add column if not exists news_date timestamptz;
alter table public.scan_events add column if not exists area_lat double precision;
alter table public.scan_events add column if not exists area_lng double precision;
