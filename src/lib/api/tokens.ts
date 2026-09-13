import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Two tokens for the app. The access token is short-lived and signed, so
 * every request is checked without a database read; the refresh token is
 * a random string whose hash sits in a row, so a lost phone can be signed
 * out from the account page.
 */

export const ACCESS_TTL_SECONDS = 60 * 60;
export const REFRESH_TTL_DAYS = 60;

function secret(): string {
  return process.env.AUTH_SECRET ?? 'insecure-development-secret';
}

export interface AccessClaims {
  sub: string;
  org: string;
  kind: 'LEARNER' | 'STAFF';
  exp: number;
}

function b64(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

export function signAccessToken(claims: Omit<AccessClaims, 'exp'>, now = Date.now(), ttlSeconds = ACCESS_TTL_SECONDS): string {
  const payload = b64(JSON.stringify({ ...claims, exp: Math.floor(now / 1000) + ttlSeconds }));
  const sig = createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function readAccessToken(token: string, now = Date.now()): AccessClaims | null {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = createHmac('sha256', secret()).update(payload).digest('base64url');
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as AccessClaims;
    if (!claims.sub || !claims.org || !claims.exp) return null;
    if (claims.exp * 1000 < now) return null;
    return claims;
  } catch {
    return null;
  }
}

export function mintRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashRefreshToken(token) };
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(`${secret()}:${token}`).digest('hex');
}

/** A one-time handoff into a web session: the app opens a web screen already signed in. */
export function signHandoff(userId: string, path: string, now = Date.now()): string {
  const payload = b64(JSON.stringify({ sub: userId, path, exp: Math.floor(now / 1000) + 120, nonce: randomBytes(8).toString('hex') }));
  const sig = createHmac('sha256', secret()).update(`handoff:${payload}`).digest('base64url');
  return `${payload}.${sig}`;
}

export function readHandoff(token: string, now = Date.now()): { sub: string; path: string; nonce: string } | null {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = createHmac('sha256', secret()).update(`handoff:${payload}`).digest('base64url');
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const c = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { sub: string; path: string; exp: number; nonce: string };
    if (c.exp * 1000 < now) return null;
    if (!c.path.startsWith('/') || c.path.startsWith('//')) return null;
    return { sub: c.sub, path: c.path, nonce: c.nonce };
  } catch {
    return null;
  }
}
