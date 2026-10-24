-- Sephora blocks cloud requests and Target/Ulta render prices with JavaScript,
-- so the extension refreshes these in the user's browser instead of the checker.
update public.stores set server_fetch = false
  where domain in ('sephora.com', 'ulta.com', 'target.com');
