'use client';
import { createClient } from '@/lib/supabase/client';

export default function SignInButton({ next = '/dashboard', label = 'Sign in with Google' }) {
  const signIn = () =>
    createClient().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
  return <button className="btn" onClick={signIn}>{label}</button>;
}
