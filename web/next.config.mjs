// Supabase URL and publishable key are public by design (they also ship in the
// extension), so they're committed here as defaults. Env vars override them.
/** @type {import('next').NextConfig} */
export default {
  images: { unoptimized: true },
  env: {
    NEXT_PUBLIC_SUPABASE_URL:
      process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://zkzedwhojkdlzlaypand.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_jCN26sNofHPXWzAZEL-W1A_KqfcPoBO',
  },
};
