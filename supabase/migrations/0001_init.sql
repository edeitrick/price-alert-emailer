-- Price Alert Emailer: initial schema
-- Run in Supabase → SQL Editor (or `supabase db push`).

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  created_at  timestamptz not null default now()
);

-- Shared store catalog. `server_fetch = false` means the cloud checker is
-- usually blocked there, so prices are refreshed by the extension instead.
create table public.stores (
  id            serial primary key,
  domain        text not null unique,          -- e.g. 'sephora.com'
  name          text not null,
  categories    text[] not null default '{general}',
  search_url    text,                          -- '{q}' is replaced by the query
  server_fetch  boolean not null default true
);

create table public.user_stores (
  user_id   uuid not null references auth.users (id) on delete cascade,
  store_id  int  not null references public.stores (id) on delete cascade,
  added_via text not null default 'saved' check (added_via in ('saved', 'manual')),
  primary key (user_id, store_id)
);

create table public.items (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  title           text not null,
  brand           text,
  gtin            text,
  category        text not null default 'general',
  image_url       text,
  baseline_price  numeric(10, 2) not null check (baseline_price > 0),
  currency        text not null default 'USD',
  threshold_pct   int not null default 15 check (threshold_pct between 1 and 95),
  active          boolean not null default true,
  matched_at      timestamptz,                 -- last cross-store search
  created_at      timestamptz not null default now()
);

create table public.listings (
  id                uuid primary key default gen_random_uuid(),
  item_id           uuid not null references public.items (id) on delete cascade,
  store_id          int  not null references public.stores (id),
  url               text not null,
  match_type        text not null check (match_type in ('origin', 'gtin', 'fuzzy', 'manual')),
  match_confidence  numeric(3, 2) not null default 1,
  status            text not null default 'active' check (status in ('active', 'confirmed', 'rejected')),
  last_price        numeric(10, 2),
  in_stock          boolean,
  last_checked_at   timestamptz,
  created_at        timestamptz not null default now(),
  unique (item_id, url)
);

create table public.price_history (
  id          bigserial primary key,
  listing_id  uuid not null references public.listings (id) on delete cascade,
  price       numeric(10, 2) not null,
  in_stock    boolean not null default true,
  source      text not null default 'server' check (source in ('server', 'extension')),
  checked_at  timestamptz not null default now()
);
create index price_history_listing_idx on public.price_history (listing_id, checked_at desc);

create table public.alerts_sent (
  id          bigserial primary key,
  item_id     uuid not null references public.items (id) on delete cascade,
  listing_id  uuid not null references public.listings (id) on delete cascade,
  price       numeric(10, 2) not null,
  sent_at     timestamptz not null default now()
);
create index alerts_sent_item_idx on public.alerts_sent (item_id, sent_at desc);

-- ---------------------------------------------------------------------------
-- Seed stores
-- ---------------------------------------------------------------------------

insert into public.stores (domain, name, categories, search_url, server_fetch) values
  ('amazon.com',  'Amazon',  '{general,beauty,electronics,home}', 'https://www.amazon.com/s?k={q}',                 false),
  ('sephora.com', 'Sephora', '{beauty}',                          'https://www.sephora.com/search?keyword={q}',     true),
  ('ulta.com',    'Ulta',    '{beauty}',                          'https://www.ulta.com/search?search={q}',         true),
  ('target.com',  'Target',  '{general,beauty,electronics,home}', 'https://www.target.com/s?searchTerm={q}',        true);

-- ---------------------------------------------------------------------------
-- New user → profile
-- ---------------------------------------------------------------------------

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row-level security: users only ever see their own rows
-- ---------------------------------------------------------------------------

alter table public.profiles      enable row level security;
alter table public.stores        enable row level security;
alter table public.user_stores   enable row level security;
alter table public.items         enable row level security;
alter table public.listings      enable row level security;
alter table public.price_history enable row level security;
alter table public.alerts_sent   enable row level security;

create policy "own profile"   on public.profiles    for select using (id = auth.uid());
create policy "stores public" on public.stores      for select to authenticated using (true);
create policy "own stores"    on public.user_stores for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own items"     on public.items       for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own listings" on public.listings for all
  using (exists (select 1 from public.items i where i.id = item_id and i.user_id = auth.uid()))
  with check (exists (select 1 from public.items i where i.id = item_id and i.user_id = auth.uid()));

create policy "own history" on public.price_history for select
  using (exists (select 1 from public.listings l join public.items i on i.id = l.item_id
                 where l.id = listing_id and i.user_id = auth.uid()));

create policy "own alerts" on public.alerts_sent for select
  using (exists (select 1 from public.items i where i.id = item_id and i.user_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- RPCs called by the extension
-- ---------------------------------------------------------------------------

-- Saves an item from the page the user is on, registering the store for them.
create function public.save_item(
  p_url text, p_domain text, p_title text, p_price numeric, p_threshold_pct int,
  p_category text default 'general', p_brand text default null, p_gtin text default null,
  p_image_url text default null, p_currency text default 'USD'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_store_id int;
  v_item_id uuid;
begin
  if v_uid is null then raise exception 'not signed in'; end if;

  insert into stores (domain, name)
    values (p_domain, initcap(split_part(p_domain, '.', 1)))
    on conflict (domain) do nothing;
  select id into v_store_id from stores where domain = p_domain;

  insert into user_stores (user_id, store_id) values (v_uid, v_store_id)
    on conflict do nothing;

  insert into items (user_id, title, brand, gtin, category, image_url, baseline_price, currency, threshold_pct)
    values (v_uid, p_title, p_brand, p_gtin, p_category, p_image_url, p_price, p_currency, p_threshold_pct)
    returning id into v_item_id;

  insert into listings (item_id, store_id, url, match_type, status, last_price, in_stock, last_checked_at)
    values (v_item_id, v_store_id, p_url, 'origin', 'confirmed', p_price, true, now());

  insert into price_history (listing_id, price, source)
    select id, p_price, 'extension' from listings where item_id = v_item_id;

  return v_item_id;
end $$;

-- Records a price the extension fetched from the user's own browser.
create function public.record_price(p_listing_id uuid, p_price numeric, p_in_stock boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from listings l join items i on i.id = l.item_id
                 where l.id = p_listing_id and i.user_id = auth.uid()) then
    raise exception 'listing not found';
  end if;
  if p_price is null or p_price <= 0 then raise exception 'invalid price'; end if;

  insert into price_history (listing_id, price, in_stock, source)
    values (p_listing_id, p_price, p_in_stock, 'extension');
  update listings set last_price = p_price, in_stock = p_in_stock, last_checked_at = now()
    where id = p_listing_id;
end $$;

revoke execute on function public.save_item, public.record_price from anon;
