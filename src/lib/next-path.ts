import { cookies } from 'next/headers';

/**
 * Where to go after signing in or signing up, when a page sent somebody to
 * the door on the way to something (a free paper, a test page). Kept in a
 * short-lived cookie rather than a query string, so every door (password,
 * code, Google, sign-up) honours it without each form carrying it along.
 * Only a path on this site is accepted: never another host.
 */

const NEXT_COOKIE = 'lms_next';

export function safeNextPath(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  if (!v.startsWith('/') || v.startsWith('//') || v.startsWith('/\\') || v.length > 300) return null;
  if (/[\r\n]/.test(v)) return null;
  return v;
}

export async function rememberNextPath(path: string): Promise<void> {
  const safe = safeNextPath(path);
  if (!safe) return;
  (await cookies()).set(NEXT_COOKIE, safe, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 });
}

/** The remembered path, once: reading it clears it. */
export async function takeNextPath(): Promise<string | null> {
  const jar = await cookies();
  const value = safeNextPath(jar.get(NEXT_COOKIE)?.value);
  if (jar.get(NEXT_COOKIE)) jar.delete(NEXT_COOKIE);
  return value;
}
