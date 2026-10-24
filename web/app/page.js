import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import SignInButton from '@/components/SignInButton';

export default async function Home({ searchParams }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect('/dashboard');
  const { error } = await searchParams;

  return (
    <section className="hero">
      <h1>Stop checking prices.</h1>
      <p>
        Save anything with the Chrome extension, pick how much off it needs to be, and we'll email you
        when it drops — whether that's at the store you found it on or another store you shop.
      </p>
      <SignInButton />
      {error && <p className="error">Sign-in didn't complete. Please try again.</p>}
      <ol className="steps">
        <li>Sign in with Google.</li>
        <li>Install the extension and connect it to your account.</li>
        <li>On any product page, click the extension and set your % off.</li>
      </ol>
    </section>
  );
}
