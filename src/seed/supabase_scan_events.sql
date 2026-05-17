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
  source_trail jsonb,
  road_coords jsonb,
  ai_summary text,
  thumbnail text,
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
alter table public.scan_events add column if not exists source_trail jsonb;
alter table public.scan_events
  alter column source_trail type jsonb
  using (
    case
      when source_trail is null then null
      else to_jsonb(source_trail)
    end
  );
alter table public.scan_events add column if not exists road_coords jsonb;
alter table public.scan_events add column if not exists ai_summary text;
alter table public.scan_events add column if not exists thumbnail text;
alter table public.scan_events add column if not exists scan_datetime timestamptz;
alter table public.scan_events add column if not exists news_date timestamptz;
alter table public.scan_events add column if not exists area_lat double precision;
alter table public.scan_events add column if not exists area_lng double precision;
alter table public.scan_events add column if not exists is_user_submitted boolean not null default false;

create index if not exists scan_events_lat_lng_idx on public.scan_events (lat, lng)
  where lat is not null and lng is not null;
create index if not exists scan_events_is_user_submitted_idx on public.scan_events (is_user_submitted)
  where is_user_submitted = true;

-- Patch migration: append UUID suffix to legacy event IDs that don't already have one.
create extension if not exists pgcrypto;

with legacy_ids as (
  select
    event_id as old_event_id,
    event_id || '-' || upper(gen_random_uuid()::text) as new_event_id
  from public.scan_events
  where event_id like 'EVT-TOPIC-%'
    and event_id !~* '-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
)
update public.scan_events as se
set
  event_id = legacy_ids.new_event_id,
  payload = case
    when jsonb_typeof(se.payload) = 'object'
      then jsonb_set(se.payload, '{id}', to_jsonb(legacy_ids.new_event_id), true)
    else se.payload
  end,
  updated_at = now()
from legacy_ids
where se.event_id = legacy_ids.old_event_id;
