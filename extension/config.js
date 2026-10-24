// Fill these in after creating your Supabase project (Project Settings → API).
// The anon key is safe to ship in the extension; never put the service-role key here.
export const SUPABASE_URL = 'https://zkzedwhojkdlzlaypand.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_jCN26sNofHPXWzAZEL-W1A_KqfcPoBO';

// Where the web app runs. Must also be listed in manifest.json → externally_connectable.
export const WEB_APP_URL = 'http://localhost:3000';

export const DEFAULT_THRESHOLD_PCT = 15;
export const CATEGORIES = ['beauty', 'general', 'electronics', 'home'];
export const DEFAULT_CATEGORY_BY_DOMAIN = {
  'sephora.com': 'beauty',
  'ulta.com': 'beauty',
};
