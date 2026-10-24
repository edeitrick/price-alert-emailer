# Price Alert Emailer

Save things you want to buy, choose how much of a discount you're waiting for, and get an email
when the price drops, with a link straight to the deal.

**Jess, these directions are for you.** Setup takes about 10 minutes. You need a computer with
Google Chrome and a Google account (Gmail).

---

## Step 1: Download the extension

1. Go to **https://github.com/edeitrick/price-alert-emailer**.
2. Click the green **Code** button, then **Download ZIP**.
3. Open your **Downloads** folder and double-click `price-alert-emailer-main.zip` to unzip it.
4. Move the unzipped `price-alert-emailer-main` folder into your **Documents** folder.

   Chrome runs the extension from this folder, so leave it there. If you delete or move it later,
   the extension stops working.

## Step 2: Add it to Chrome

1. In Chrome, type `chrome://extensions` into the address bar and press Enter.
2. Turn on **Developer mode** with the switch in the top-right corner.
3. Click **Load unpacked** (top left).
4. Open `Documents` → `price-alert-emailer-main`, click the folder named **`extension`** once to
   select it, then click **Select**.
5. **Price Alert Emailer** now appears in your list of extensions.
6. Click the **puzzle-piece icon** to the right of Chrome's address bar, then click the **pin**
   next to Price Alert Emailer. Its icon now stays in your toolbar.

## Step 3: Sign in

1. Click the **Price Alert Emailer** icon in your toolbar.
2. Click **Sign in with Google**. A new tab opens.
3. Choose your Google account. If Google asks you to confirm signing in, click **Continue**.
4. The page says **"✓ Connected."** You can close that tab.

## Step 4: Save your first item

1. Open a product page on **Amazon, Sephora, Ulta, or Target**.
2. Click the **Price Alert Emailer** icon. You'll see the product's name, picture, and price.
   - If the price box is empty, type in the price shown on the page.
3. Under **Alert me when it's at least __% off**, enter the discount you're waiting for. The
   default is 15%. The line underneath shows the exact price you'll be emailed at.
4. Check the **Category** (Beauty, General, Electronics, or Home). It controls which of your other
   stores get checked for the same item.
5. Click **Save alert**. You'll see **"✓ Saved."**

## Step 5: See and manage your alerts

Go to **https://price-alert-emailer.vercel.app/dashboard**, or click **Open dashboard** after
saving an item. Each saved item shows:

- **Its prices** at each store, with links.
- **Alert at __% off:** change the number and click **Update**.
- **Pause alerts / Resume alerts:** stop emails for an item without deleting it.
- **Delete:** remove the item completely.
- **Paste this item's link from another store:** if you've seen the same product elsewhere, paste
  that link and click **Add store**. The app then watches both stores and emails you about
  whichever one is cheaper.
- **✓ / ✗ on possible matches:** sometimes the app finds what it thinks is the same item at
  another store you shop at. Click ✓ if it's the same product, ✗ if it isn't.

---

## What to expect

- **Prices are checked every 6 hours.**
- **Alert emails come from `alerts@alerts.beyondaiaccess.com`.** Add that address to your contacts
  so alerts don't land in spam. Check your spam folder the first time.
- **You get one email per drop.** You only get another if the price falls even further.
- **Amazon prices are checked by the extension in your own Chrome, so Chrome needs to be open.**
  It doesn't have to be the window you're using; just don't quit Chrome entirely.
- **Early version:** Sephora, Ulta, and Target items save fine, but automatic price updates for
  those stores aren't working yet. Amazon is the most reliable store right now.

---

## If something goes wrong

| What you see | What to do |
|---|---|
| **"Couldn't reach the extension"** after signing in | Go to `chrome://extensions`, click the circular **reload arrow** on Price Alert Emailer, then click its icon and **Sign in with Google** again. |
| The popup asks you to sign in again | Click **Sign in with Google**; you won't need to re-enter your password if you're still signed in to Google. |
| **"Couldn't read the price on this page"** | Type the price in yourself and save as normal. |
| The extension disappeared | The `price-alert-emailer-main` folder was probably moved or deleted. Repeat Steps 1 and 2. |
| No emails at all | Check spam, and check the dashboard: is the item paused, or has the price not yet dropped by your %? |

## Getting updates

When Elise says there's a new version:

1. Download the ZIP again (Step 1) and replace your old `price-alert-emailer-main` folder in
   Documents with the new one.
2. Go to `chrome://extensions` and click the **reload arrow** on Price Alert Emailer.

Your saved items are stored online, so you won't lose them.

---

*Setting up your own copy of the whole app (database, website, email)? See
[docs/SETUP.md](docs/SETUP.md).*
