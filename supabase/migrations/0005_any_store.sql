-- Every store is read in the user's browser (stores block or don't render prices
-- for the cloud checker), and any store can be searched once we know its search page.

alter table public.stores alter column server_fetch set default false;
update public.stores set server_fetch = false where server_fetch;

update public.stores set search_url = 'https://www.hoka.com/on/demandware.store/Sites-HOKA-US-Site/en_US/Coveo-Show?q={q}'
  where domain = 'hoka.com' and search_url is null;
update public.stores set search_url = 'https://www.dickssportinggoods.com/search/SearchDisplay?searchTerm={q}'
  where domain = 'dickssportinggoods.com' and search_url is null;

-- save_item also records the store's search page (read from its search box) the first time.
drop function public.save_item(text, text, text, numeric, int, text, text, text, text, text, text, numeric, int);

create function public.save_item(
  p_url text, p_domain text, p_title text, p_price numeric, p_threshold_pct int,
  p_category text default 'general', p_brand text default null, p_gtin text default null,
  p_image_url text default null, p_currency text default 'USD',
  p_size text default null, p_size_value numeric default null, p_pack int default null,
  p_search_url text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_store_id int;
  v_item_id uuid;
  -- Only accept a search page on the store's own site.
  v_search_host text := split_part(split_part(coalesce(p_search_url, ''), '://', 2), '/', 1);
  v_search_ok boolean := p_search_url like 'https://%{q}%'
    and (v_search_host = p_domain or v_search_host like '%.' || p_domain);
begin
  if v_uid is null then raise exception 'not signed in'; end if;

  insert into stores (domain, name, search_url)
    values (p_domain, initcap(split_part(p_domain, '.', 1)),
            case when v_search_ok then p_search_url end)
    on conflict (domain) do nothing;
  update stores set search_url = p_search_url
    where domain = p_domain and search_url is null and v_search_ok;
  select id into v_store_id from stores where domain = p_domain;

  insert into user_stores (user_id, store_id) values (v_uid, v_store_id)
    on conflict do nothing;

  insert into items (user_id, title, brand, gtin, category, image_url, baseline_price, currency,
                     threshold_pct, size, size_value, pack)
    values (v_uid, p_title, p_brand, p_gtin, p_category, p_image_url, p_price, p_currency,
            p_threshold_pct, p_size, p_size_value, p_pack)
    returning id into v_item_id;

  insert into listings (item_id, store_id, url, match_type, status, last_price, in_stock, last_checked_at, size)
    values (v_item_id, v_store_id, p_url, 'origin', 'confirmed', p_price, true, now(), p_size);

  insert into price_history (listing_id, price, source)
    select id, p_price, 'extension' from listings where item_id = v_item_id;

  return v_item_id;
end $$;
revoke execute on function public.save_item from anon;

-- Merge suggestions: also require matching model numbers ("Clifton 10" ≠ "Clifton 11")
-- and the same gender (women's ≠ men's), like the extension's matcher.
create or replace function public.title_numbers(t text) returns text
language sql immutable as $$
  select coalesce(string_agg(n, ',' order by n), '') from (
    select distinct m[1] as n
    from regexp_matches(lower(t), '(?<![\d.])(\d+)(?![\d.]|\s*(fl|oz|ml|g|kg|lb|lbs|ct|count|pack|pk|items?|pieces)\M)', 'g') as m
  ) nums
$$;

create or replace function public.title_gender(t text) returns text
language sql immutable as $$
  select case
    when lower(t) ~ '\m(women''?s?|womens|ladies)\M' then 'women'
    when lower(t) ~ '\m(men''?s?|mens)\M' then 'men'
    when lower(t) ~ '\m(kids''?|boys''?|girls''?|youth|toddler|baby)\M' then 'kids'
  end
$$;

create or replace function public.suggest_merges() returns table (item_a uuid, item_b uuid, score real)
language sql stable security invoker set search_path = public as $$
  select a_id, b_id, score from (
    select a.id as a_id, b.id as b_id,
      case when a.gtin is not null and ltrim(a.gtin, '0') = ltrim(b.gtin, '0') then 1::real
           else greatest(
                  word_similarity(lower(coalesce(a.brand, '') || ' ' || a.title),
                                  lower(coalesce(b.brand, '') || ' ' || b.title)),
                  word_similarity(lower(coalesce(b.brand, '') || ' ' || b.title),
                                  lower(coalesce(a.brand, '') || ' ' || a.title)))
      end as score
    from items a
    join items b on b.user_id = a.user_id and a.created_at < b.created_at
    where a.user_id = auth.uid()
      and not (a.size_value is not null and b.size_value is not null
               and abs(a.size_value - b.size_value) / greatest(a.size_value, b.size_value) > 0.03)
      and not (a.pack is not null and b.pack is not null and a.pack <> b.pack)
      and not (title_numbers(a.title) <> '' and title_numbers(b.title) <> ''
               and title_numbers(a.title) <> title_numbers(b.title))
      and not (title_gender(a.title) is not null and title_gender(b.title) is not null
               and title_gender(a.title) <> title_gender(b.title))
      and not exists (
        select 1 from merge_dismissals d
        where (d.item_a, d.item_b) in ((a.id, b.id), (b.id, a.id)))
  ) pairs
  where score >= 0.6
  order by score desc
  limit 10
$$;
