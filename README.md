# Price Alert Emailer

Save things you want to buy, choose how much of a discount you're waiting for, and get an email
when the price drops, with a link straight to the deal.

**Jess, these directions are for you.** Setup takes about 10 minutes. You need a computer with
Google Chrome and a Google account (Gmail).

> **Already set up? A new version is out.** Skip to [Updating to a new version](#updating-to-a-new-version)
> (about 2 minutes). New in this version: the app finds your items at your other stores, pays
> attention to sizes, and lets you merge items you saved twice.

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
- **✓ / ✗ on possible matches:** the app looks for the same item at other stores you've saved
  from, and shows what it finds with its price. Click ✓ if it's the same product, ✗ if it isn't.
  Anything it isn't sure about isn't used for alerts until you click ✓.
- **Sizes:** each item and store shows its size (for example, 13.52 fl oz, or Pack of 2). The app
  won't treat a different size or pack count as the same product.
- **Merge into this:** saved the same product twice, say once from Amazon and once from Target?
  Pick the other one from the menu under an item and click **Merge into this**. All its store links
  move onto this item, so you get one alert for whichever store is cheapest.
- **"These look like the same product":** when two of your items look alike, a box at the top
  suggests merging them. Click **Merge them**, or **Not the same** and it won't ask again.

---

## What to expect

- **Prices are checked every 6 hours.**
- **Alert emails come from `alerts@alerts.beyondaiaccess.com`.** Add that address to your contacts
  so alerts don't land in spam. Check your spam folder the first time.
- **You get one email per drop.** You only get another if the price falls even further.
- **Prices are read by the extension in your own Chrome, so Chrome needs to be open.** Every 6
  hours a minimized Chrome window briefly opens, loads your saved products, and closes again.
  That's normal. Chrome doesn't need to be the window you're using, but don't quit it entirely.
- **Want a fresh check right away?** Click the extension icon, then **Check my prices now** at the
  bottom. It also shows when your prices were last checked.
- **Other stores are only checked if you've used them.** The app searches stores you've saved an
  item from or pasted a link from, and only ones that sell that kind of item. It searches Amazon,
  Sephora, Ulta, and Target; other stores (like Hoka or Dick's) are watched for the links you save,
  but not searched.
- **After you save something,** a minimized window opens for a minute or two while the app looks
  for it at your other stores. Prices it finds show up on the dashboard right away.

---

## If something goes wrong

| What you see | What to do |
|---|---|
| **"Couldn't reach the extension"** after signing in | Go to `chrome://extensions`, click the circular **reload arrow** on Price Alert Emailer, then click its icon and **Sign in with Google** again. |
| The popup asks you to sign in again | Click **Sign in with Google**; you won't need to re-enter your password if you're still signed in to Google. |
| **"Couldn't read the price on this page"** | Type the price in yourself and save as normal. |
| The extension disappeared | The `price-alert-emailer-main` folder was probably moved or deleted. Repeat Steps 1 and 2. |
| An error on `chrome://extensions` after updating | The new folder isn't in the same place or has a different name. See step 5 of [Updating](#updating-to-a-new-version). |
| No emails at all | Check spam, and check the dashboard: is the item paused, or has the price not yet dropped by your %? |

## Updating to a new version

When Elise says there's a new version (about 2 minutes):

1. **Download the new version:** go to **https://github.com/edeitrick/price-alert-emailer**, click
   the green **Code** button, then **Download ZIP**.
2. **Unzip it:** in **Downloads**, double-click `price-alert-emailer-main.zip`. You'll get a new
   `price-alert-emailer-main` folder. If your Mac names it `price-alert-emailer-main 2`, rename it to
   `price-alert-emailer-main`.
3. **Replace the old folder:** in **Documents**, drag the old `price-alert-emailer-main` folder to
   the Trash, then move the new one into **Documents**. It must end up in exactly the same place
   with exactly the same name, so Chrome can find it.
4. **Reload the extension:** go to `chrome://extensions` and click the circular **reload arrow** on
   Price Alert Emailer.
5. **Check it worked:** click the extension icon. You should see **Check my prices now** at the
   bottom. If Chrome shows an error, or the extension is missing, click **Remove** on it, then
   **Load unpacked** and pick the `extension` folder again (Step 2). You'll need to sign in again
   (Step 3).

Your saved items and alerts are stored online, so updating never loses them.

---

*Setting up your own copy of the whole app (database, website, email)? See
[docs/SETUP.md](docs/SETUP.md).*
