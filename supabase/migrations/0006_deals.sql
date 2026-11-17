-- Deals the extension finds on a listing's page: site-wide sales, bundles,
-- multi-buys and coupons. Stored on the user's own listing (never on the shared
-- store), and recomputed and sanity-checked by the checker before any email.
-- Additive only: older extensions and checkers keep working.

alter table public.listings
  add column if not exists deals jsonb not null default '[]'::jsonb,
  add column if not exists deals_seen_at timestamptz;

-- Alerts now have a kind, so a deal email never suppresses a later price-drop email.
alter table public.alerts_sent
  add column if not exists kind text not null default 'price'
    check (kind in ('price', 'sitewide', 'bundle')),
  add column if not exists deal_key text;
