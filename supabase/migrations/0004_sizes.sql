-- Product sizes: different sizes or pack counts are different products.

alter table public.items
  add column size text,              -- as shown, e.g. '13.52 fl oz'
  add column size_value numeric,     -- in ounce-equivalents, for comparing
  add column pack int;               -- pack count when known
alter table public.listings
  add column size text;

-- save_item gains size arguments (with defaults, so older extensions keep working).
drop function public.save_item(text, text, text, numeric, int, text, text, text, text, text);

create function public.save_item(
  p_url text, p_domain text, p_title text, p_price numeric, p_threshold_pct int,
  p_category text default 'general', p_brand text default null, p_gtin text default null,
  p_image_url text default null, p_currency text default 'USD',
  p_size text default null, p_size_value numeric default null, p_pack int default null
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

-- Same as before, but never suggest merging different sizes or pack counts.
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
      and not exists (
        select 1 from merge_dismissals d
        where (d.item_a, d.item_b) in ((a.id, b.id), (b.id, a.id)))
  ) pairs
  where score >= 0.6
  order by score desc
  limit 10
$$;
