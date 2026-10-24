# Price Alert Emailer

Save products with a Chrome extension, choose how much off they need to be, and get an email when the
price drops — at the store you saved from **or** at other stores you shop in the same category.

| Part | Where | Hosted on (free) |
|---|---|---|
| `web/` | Next.js app: Google sign-in, dashboard, extension connect page | Vercel |
| `supabase/` | Postgres schema, row-level security, RPCs | Supabase |
| `extension/` | Chrome extension (Manifest V3, no build step) | Chrome Web Store / load unpacked |
| `checker/` | Price checker + emailer, every 6 hours | GitHub Actions |

## Setup

### 1. Supabase
1. Create a project at supabase.com.
2. SQL Editor → paste and run `supabase/migrations/0001_init.sql`.
3. Project Settings → API: copy the **URL**, **anon key**, and **service-role key**.
4. Authentication → URL Configuration: set **Site URL** to your web app URL and add
   `http://localhost:3000/**` and `https://<your-app>.vercel.app/**` to **Redirect URLs**.

### 2. Google sign-in
1. console.cloud.google.com → new project → APIs & Services → OAuth consent screen
   (External; scopes `openid`, `email`, `profile` only — no Google verification needed).
2. Credentials → Create OAuth client ID → **Web application**.
   Authorized redirect URI: `https://<your-project>.supabase.co/auth/v1/callback`.
3. Supabase → Authentication → Providers → Google: paste the client ID and secret, enable.

### 3. Run the web app locally
```bash
cp .env.example .env.local      # fill in the values
cp .env.local web/.env.local
cd web && npm install && npm run dev
```
Open http://localhost:3000 and sign in.

### 4. Load the extension
1. Fill in `extension/config.js` (Supabase URL + **anon** key, web app URL).
2. chrome://extensions → Developer mode → **Load unpacked** → pick the `extension/` folder.
3. Click the extension → **Sign in with Google** → it connects automatically.
4. Open a product page (Sephora, Ulta, Target, Amazon…) → click the extension → set % off → Save.

### 5. Email (Resend)
Create an API key at resend.com. Without a verified domain, Resend only delivers to the address you
signed up with — fine for testing. To email other users, verify a domain and set `EMAIL_FROM`.

### 6. Scheduled checker (GitHub Actions)
Repo → Settings → Secrets and variables → Actions → add:
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, `WEB_APP_URL`.
Then Actions → **Check prices** → **Run workflow** to test. It runs every 6 hours after that.
Run it locally with `cd checker && npm install && npm run check`.

### 7. Deploy the web app (Vercel)
Import the repo on vercel.com, set **Root Directory** to `web`, add the two `NEXT_PUBLIC_…` env vars.
Then add the Vercel URL to: Supabase redirect URLs, `extension/manifest.json` → `externally_connectable`,
`extension/config.js` → `WEB_APP_URL`, and the `WEB_APP_URL` GitHub secret.

## How price checks work
- **Cross-store matching:** for each item, the checker searches your other saved stores whose categories
  include the item's category (beauty → Sephora, Ulta, Target…). It matches by barcode (GTIN) when available,
  otherwise brand + title + size. Matches ≥ 85% confident are used automatically; lower ones wait for you
  to confirm ✓/✗ on the dashboard. You can also paste a link from another store yourself.
- **Prices:** stores that allow it are checked from GitHub Actions. Stores that block cloud servers
  (Amazon, `server_fetch = false`) are refreshed by the extension from your browser every 6 hours while Chrome is open.
- **Emails:** sent when the cheapest trusted, in-stock listing is at least your % below the price you saved at,
  and only again if it drops further.

Store sites change often; if a store's price stops being found, check the Actions log for
`price check failed` lines. Respect each store's terms of use.
