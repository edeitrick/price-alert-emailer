'use client';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { createClient } from '@/lib/supabase/client';
import SignInButton from '@/components/SignInButton';

// Hands the signed-in session to the Chrome extension (extension ID comes from ?ext=).
function Connect() {
  const ext = useSearchParams().get('ext');
  const [status, setStatus] = useState('checking');

  useEffect(() => {
    createClient().auth.getSession().then(({ data: { session } }) => {
      if (!session) return setStatus('signed-out');
      if (!ext || !window.chrome?.runtime?.sendMessage) return setStatus('no-extension');
      window.chrome.runtime.sendMessage(ext, {
        type: 'session',
        session: {
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          expires_at: session.expires_at,
          email: session.user.email,
        },
      }, (resp) => setStatus(resp?.ok ? 'connected' : 'no-extension'));
    });
  }, [ext]);

  return (
    <section className="hero">
      <h1>Connect the extension</h1>
      {status === 'checking' && <p>Connecting…</p>}
      {status === 'signed-out' && (
        <>
          <p>Sign in first, then we'll connect the extension automatically.</p>
          <SignInButton next={`/connect?ext=${encodeURIComponent(ext ?? '')}`} />
        </>
      )}
      {status === 'connected' && <p>✓ Connected. You can close this tab and start saving items.</p>}
      {status === 'no-extension' && (
        <p className="error">
          Couldn't reach the extension. Open this page from the extension's “Sign in” button, and make sure
          this site's address is listed in the extension's manifest under externally_connectable.
        </p>
      )}
    </section>
  );
}

export default function ConnectPage() {
  return <Suspense><Connect /></Suspense>;
}
