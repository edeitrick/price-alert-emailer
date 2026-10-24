// Minimal Supabase REST client for the extension (no bundler needed).
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';

export async function getSession() {
  const { session } = await chrome.storage.local.get('session');
  if (!session) return null;
  if (session.expires_at * 1000 > Date.now() + 60_000) return session;
  return refresh(session.refresh_token);
}

export async function setSession(session) {
  await chrome.storage.local.set({ session });
}

export async function clearSession() {
  await chrome.storage.local.remove('session');
}

async function refresh(refreshToken) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!res.ok) {
    await clearSession();
    return null;
  }
  const data = await res.json();
  const session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at,
    email: data.user?.email,
  };
  await setSession(session);
  return session;
}

export async function api(path, { method = 'GET', body } = {}) {
  const session = await getSession();
  if (!session) throw new Error('Not connected — open the extension and connect your account.');
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error((await res.text()) || `Request failed (${res.status})`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export const rpc = (fn, args) => api(`/rest/v1/rpc/${fn}`, { method: 'POST', body: args });
