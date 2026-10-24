-- Merging duplicate items, and suggesting merges for items that look alike.

-- Pairs the user said are *not* the same product, so we stop suggesting them.
create table public.merge_dismissals (
  user_id  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  item_a   uuid not null references public.items (id) on delete cascade,
  item_b   uuid not null references public.items (id) on delete cascade,
  primary key (user_id, item_a, item_b)
);
alter table public.merge_dismissals enable row level security;
create policy "own dismissals" on public.merge_dismissals for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Moves every store listing (and alert history) from p_merge onto p_keep,
-- then deletes p_merge. p_keep keeps its own price target and % off.
create function public.merge_items(p_keep uuid, p_merge uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_keep = p_merge then raise exception 'cannot merge an item with itself'; end if;
  if (select count(*) from items where id in (p_keep, p_merge) and user_id = auth.uid()) <> 2 then
    raise exception 'item not found';
  end if;

  -- Same link on both items: keep the kept item's copy.
  delete from listings
    where item_id = p_merge and url in (select url from listings where item_id = p_keep);
  update listings set item_id = p_keep where item_id = p_merge;
  update alerts_sent set item_id = p_keep where item_id = p_merge;
  update items set matched_at = null where id = p_keep; -- re-search other stores
  delete from items where id = p_merge;
end $$;

-- Pairs of the user's items that look like the same product: same barcode,
-- or similar brand + title. Older item first.
create function public.suggest_merges() returns table (item_a uuid, item_b uuid, score real)
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
      and not exists (
        select 1 from merge_dismissals d
        where (d.item_a, d.item_b) in ((a.id, b.id), (b.id, a.id)))
  ) pairs
  where score >= 0.6
  order by score desc
  limit 10
$$;

revoke execute on function public.merge_items, public.suggest_merges from anon;
