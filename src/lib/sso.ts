import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { resolveIntegration } from '@/lib/integration-store';

/**
 * Signing in with Google or Microsoft.
 *
 * Plain OAuth 2, no library. What matters here is not the protocol, which is
 * four HTTP calls, but the three things people leave out of it.
 *
 * The state parameter is signed and kept in a cookie, and the callback refuses
 * anything that does not match. Without it, an attacker can start a flow and
 * hand somebody a callback URL that signs them into the attacker's account.
 *
 * The email must come back verified. Google and Microsoft will both tell you
 * about an unverified address, and treating one as proof of identity means
 * anybody who can claim an address can walk into that account.
 *
 * And the provider is never allowed to create an account here. It matches an
 * existing learner or it refuses, because an institute's roll is not something
 * a stranger with a Gmail address gets to add themselves to.
 */

const STATE_COOKIE = 'mlms_oauth';
const STATE_MINUTES = 10;

export type Provider = 'google' | 'microsoft';

export interface ProviderConfig {
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
}

export async function providerConfig(
  organizationId: string,
  provider: Provider,
): Promise<ProviderConfig | null> {
  if (provider === 'google') {
    const resolved = await resolveIntegration(organizationId, 'google_sso');
    if (!resolved?.complete) return null;
    return {
      clientId: resolved.values.clientId,
      clientSecret: resolved.values.clientSecret,
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scope: 'openid email profile',
    };
  }

  const resolved = await resolveIntegration(organizationId, 'microsoft_sso');
  if (!resolved?.complete) return null;

  // The directory id, or "common" for an app that accepts any Microsoft
  // account, which is what an institute with students on personal accounts
  // needs.
  const directory = resolved.values.tenantId || 'common';
  return {
    clientId: resolved.values.clientId,
    clientSecret: resolved.values.clientSecret,
    authorizeUrl: `https://login.microsoftonline.com/${directory}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${directory}/oauth2/v2.0/token`,
    scope: 'openid email profile User.Read',
  };
}

function secret(): string {
  return process.env.AUTH_SECRET || 'insecure-development-secret';
}

export async function issueState(provider: Provider): Promise<string> {
  const nonce = randomBytes(16).toString('base64url');
  const expiresAt = Date.now() + STATE_MINUTES * 60_000;
  const body = `${provider}.${nonce}.${expiresAt}`;
  const signature = createHmac('sha256', secret()).update(body).digest('base64url');
  const state = `${body}.${signature}`;

  (await cookies()).set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: new Date(expiresAt),
  });

  return state;
}

export async function consumeState(provider: Provider, supplied: string | null): Promise<boolean> {
  const jar = await cookies();
  const stored = jar.get(STATE_COOKIE)?.value ?? null;
  jar.delete(STATE_COOKIE);

  if (!stored || !supplied) return false;

  const a = Buffer.from(stored);
  const b = Buffer.from(supplied);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

  const [who, nonce, expiry, signature] = stored.split('.');
  if (who !== provider || !nonce || !signature) return false;

  const expiresAt = Number(expiry);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;

  const expected = createHmac('sha256', secret())
    .update(`${who}.${nonce}.${expiry}`)
    .digest('base64url');

  const x = Buffer.from(expected);
  const y = Buffer.from(signature);
  return x.length === y.length && timingSafeEqual(x, y);
}

export interface Identity {
  providerAccountId: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
}

/** The id token is a JWT; the claims are the middle segment. */
function claimsOf(idToken: string): Record<string, unknown> | null {
  const parts = idToken.split('.');
  if (parts.length < 2) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

export async function exchangeCode(input: {
  config: ProviderConfig;
  code: string;
  redirectUri: string;
}): Promise<Identity | null> {
  const response = await fetch(input.config.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: input.config.clientId,
      client_secret: input.config.clientSecret,
      code: input.code,
      grant_type: 'authorization_code',
      redirect_uri: input.redirectUri,
    }),
    cache: 'no-store',
  });

  if (!response.ok) return null;

  const token = (await response.json()) as { id_token?: string };
  if (!token.id_token) return null;

  // The token came straight from the provider's own endpoint over TLS in
  // response to our client secret, so the claims are read rather than verified
  // against the signing keys. That is the one shortcut here, and it holds only
  // because this code path never accepts an id token from anywhere else.
  const claims = claimsOf(token.id_token);
  if (!claims) return null;

  const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : null;
  const subject = typeof claims.sub === 'string' ? claims.sub : null;
  if (!email || !subject) return null;

  // Google says email_verified; Microsoft does not send it for work accounts,
  // where the directory has already done the verifying.
  const verified =
    claims.email_verified === true ||
    claims.email_verified === 'true' ||
    typeof claims.tid === 'string';

  return {
    providerAccountId: subject,
    email,
    emailVerified: verified,
    name: typeof claims.name === 'string' ? claims.name : null,
  };
}
