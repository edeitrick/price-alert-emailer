'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

const done = () => revalidatePath('/dashboard');

export async function updateThreshold(formData) {
  const supabase = await createClient();
  const pct = Math.min(95, Math.max(1, parseInt(formData.get('threshold_pct'), 10) || 15));
  await supabase.from('items').update({ threshold_pct: pct }).eq('id', formData.get('item_id'));
  done();
}

export async function toggleActive(formData) {
  const supabase = await createClient();
  await supabase.from('items').update({ active: formData.get('active') !== 'true' }).eq('id', formData.get('item_id'));
  done();
}

export async function deleteItem(formData) {
  const supabase = await createClient();
  await supabase.from('items').delete().eq('id', formData.get('item_id'));
  done();
}

export async function setListingStatus(formData) {
  const status = formData.get('status');
  if (!['confirmed', 'rejected'].includes(status)) return;
  const supabase = await createClient();
  await supabase.from('listings').update({ status }).eq('id', formData.get('listing_id'));
  done();
}

// Lets the user paste the same product's link from another store they shop.
export async function addListing(formData) {
  const supabase = await createClient();
  let url;
  try {
    url = new URL(String(formData.get('url')).trim());
  } catch {
    redirect('/dashboard?error=That link doesn\'t look like a valid URL.');
  }
  const domain = url.hostname.replace(/^www\./, '').split('.').slice(-2).join('.');
  const { data: store } = await supabase.from('stores').select('id').eq('domain', domain).maybeSingle();
  if (!store) redirect(`/dashboard?error=${encodeURIComponent(`${domain} isn't supported yet.`)}`);

  const { data: { user } } = await supabase.auth.getUser();
  await supabase.from('user_stores').upsert({ user_id: user.id, store_id: store.id, added_via: 'manual' }, { ignoreDuplicates: true });
  await supabase.from('listings').insert({
    item_id: formData.get('item_id'),
    store_id: store.id,
    url: url.toString(),
    match_type: 'manual',
    status: 'confirmed',
  });
  done();
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/');
}
