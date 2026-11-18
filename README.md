# Price Alert Emailer

Save a product, choose the discount you are waiting for, and get one email when the price gets
there, at the store you saved it from or at another store you already shop.

**Installing the extension?** Follow [docs/INSTALL.md](docs/INSTALL.md). It takes about 10 minutes.

## Why it exists

I built it for a friend who was waiting on a few products to go on sale. It is designed around a
single promise: an email means the item is worth buying now.

## Product decisions

| Decision | Reason |
|---|---|
| One email per drop, and another only if the price falls further | Alerts that repeat get ignored |
| The same product is tracked across stores, and the cheapest one wins | The saved store is rarely the cheapest |
| A different size, pack count, model number, or edition is never treated as the same product | A wrong match is worse than a missed one |
| Matches under 85% confidence wait for a ✓ or ✗ from the user | The app should not guess with someone's money |
| Store-wide sales, bundles, and coupons count toward the target; card-only and subscription offers do not | Only deals anyone can get are worth an email |
| Prices are read in the user's own Chrome for stores that block servers | It works on the stores people actually use |
| Setup is a sign-in with Google, with no settings to configure | Anyone should be able to start in minutes |

## How it works

| Part | What it does | Runs on |
|---|---|---|
| `extension/` | Chrome extension that reads the product, price, size, and any deals from the page | The user's browser |
| `web/` | Sign-in and the dashboard for managing alerts and confirming matches | Vercel (Next.js) |
| `supabase/` | Database with row-level security, so each person can read only their own items | Supabase (Postgres) |
| `checker/` | Checks prices every 6 hours, finds the item at other stores, and sends the emails | GitHub Actions |

The deal parser has its own tests (`npm test` in `checker/`), and the checker has a dry-run mode that
logs the emails it would send without sending them. To run your own copy, see
[docs/SETUP.md](docs/SETUP.md).

## How it was built

I am a product leader, not a software engineer. I decided what this should do, wrote the
requirements, and turned what broke in real use into the next round of requirements.
[Claude Code](https://claude.com/claude-code) wrote the code, and every commit says so.

The commit history is the record of that loop. Most releases began with a specific failure, such as
a check that stopped after five minutes or a gift-card banner mistaken for a sale, and ended with a
rule the product now follows.
