import { createClient } from '@/lib/supabase/server';
import { updateThreshold, toggleActive, deleteItem, setListingStatus, addListing, signOut } from './actions';

const money = (n) => (n == null ? '—' : `$${Number(n).toFixed(2)}`);
const AUTO_MATCH = 0.85;

function ListingRow({ listing }) {
  const pending = listing.status === 'active' && listing.match_type !== 'origin';
  return (
    <tr className={listing.status === 'rejected' ? 'rejected' : ''}>
      <td><a href={listing.url} target="_blank" rel="noreferrer">{listing.stores.name}</a></td>
      <td>{money(listing.last_price)}{listing.in_stock === false && <span className="muted"> (out of stock)</span>}</td>
      <td className="muted">
        {listing.match_type === 'origin' && 'Saved here'}
        {listing.match_type === 'manual' && 'Added by you'}
        {pending && `Possible match (${Math.round(listing.match_confidence * 100)}%${listing.match_confidence >= AUTO_MATCH ? ', used' : ', not used until confirmed'})`}
        {listing.status === 'confirmed' && ['gtin', 'fuzzy'].includes(listing.match_type) && 'Confirmed match'}
        {listing.status === 'rejected' && 'Not a match'}
      </td>
      <td>
        {pending && (
          <form action={setListingStatus} className="inline">
            <input type="hidden" name="listing_id" value={listing.id} />
            <button name="status" value="confirmed" title="Same product">✓</button>
            <button name="status" value="rejected" title="Different product">✗</button>
          </form>
        )}
      </td>
    </tr>
  );
}

function ItemCard({ item }) {
  const target = item.baseline_price * (1 - item.threshold_pct / 100);
  const listings = [...item.listings].sort((a, b) => (a.match_type === 'origin' ? -1 : b.match_type === 'origin' ? 1 : 0));
  return (
    <article className={`card ${item.active ? '' : 'paused'}`}>
      <div className="card-head">
        {item.image_url && <img src={item.image_url} alt="" />}
        <div>
          <h3>{item.title}</h3>
          <p className="muted">
            Saved at {money(item.baseline_price)} · alert at {money(target)} or less · {item.category}
            {!item.active && ' · paused'}
          </p>
        </div>
      </div>

      <form action={updateThreshold} className="inline">
        <input type="hidden" name="item_id" value={item.id} />
        <label>Alert at <input name="threshold_pct" type="number" min="1" max="95" defaultValue={item.threshold_pct} /> % off</label>
        <button>Update</button>
      </form>

      <table>
        <tbody>{listings.map((l) => <ListingRow key={l.id} listing={l} />)}</tbody>
      </table>

      <form action={addListing} className="inline">
        <input type="hidden" name="item_id" value={item.id} />
        <input name="url" type="url" placeholder="Paste this item's link from another store" required />
        <button>Add store</button>
      </form>

      <div className="card-actions">
        <form action={toggleActive}>
          <input type="hidden" name="item_id" value={item.id} />
          <input type="hidden" name="active" value={String(item.active)} />
          <button className="link">{item.active ? 'Pause alerts' : 'Resume alerts'}</button>
        </form>
        <form action={deleteItem}>
          <input type="hidden" name="item_id" value={item.id} />
          <button className="link danger">Delete</button>
        </form>
      </div>
    </article>
  );
}

export default async function Dashboard({ searchParams }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await searchParams;

  const [{ data: items }, { data: myStores }] = await Promise.all([
    supabase.from('items').select('*, listings(*, stores(name, domain))').order('created_at', { ascending: false }),
    supabase.from('user_stores').select('stores(name)'),
  ]);

  return (
    <>
      <div className="dash-head">
        <div>
          <h1>Your alerts</h1>
          <p className="muted">
            Emails go to {user.email}. Prices are checked every 6 hours.
            {myStores?.length > 0 && <> Your stores: {myStores.map((s) => s.stores.name).join(', ')}.</>}
          </p>
        </div>
        <form action={signOut}><button className="link">Sign out</button></form>
      </div>

      {error && <p className="error">{error}</p>}

      {!items?.length ? (
        <p className="empty">
          Nothing saved yet. Install the Chrome extension, open a product page, and click the extension icon to save it.
        </p>
      ) : (
        items.map((item) => <ItemCard key={item.id} item={item} />)
      )}
    </>
  );
}
