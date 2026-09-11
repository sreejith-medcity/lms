import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * One login across two systems that share nothing but a secret.
 *
 * The LMS signs a short note ("this person, this name, this email, valid
 * for five minutes") and sends the browser to the partner with it. The
 * partner checks the signature with the same secret, finds or makes the
 * account, and signs the person in. The partner later posts a result back
 * with a signature over the body, checked the same way. No cookies cross
 * the domain boundary and no password exists on the partner side, which
 * is the whole point: the learner has one login, ours.
 *
 * Pure: the routes hand in the clock and the secret.
 */

export interface HandoffClaims {
  /** Our user id: the partner keys its account on this. */
  sub: string;
  name: string;
  email: string | null;
  phone: string | null;
  /** Our organisation, so a partner serving two academies keeps them apart. */
  org: string;
  /** Where the partner should send the learner afterwards, on the LMS. */
  returnTo?: string;
  /** Anything the partner needs to decide what to show: levels, courses. */
  grants?: string[];
  /** Issued and expiry, seconds since the epoch. */
  iat: number;
  exp: number;
  /** A random value so a token is only ever good once, if the partner keeps a list. */
  jti: string;
}

const TTL_SECONDS = 300;

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function hmac(secret: string, data: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function signHandoff(
  claims: Omit<HandoffClaims, 'iat' | 'exp' | 'jti'> & { jti: string },
  secret: string,
  now: Date,
  ttlSeconds = TTL_SECONDS,
): string {
  const iat = Math.floor(now.getTime() / 1000);
  const full: HandoffClaims = { ...claims, iat, exp: iat + ttlSeconds };
  const body = b64url(JSON.stringify(full));
  return `${body}.${hmac(secret, body)}`;
}

export type HandoffVerdict =
  | { ok: true; claims: HandoffClaims }
  | { ok: false; reason: 'MALFORMED' | 'BAD_SIGNATURE' | 'EXPIRED' | 'NOT_YET' };

export function verifyHandoff(token: string, secret: string, now: Date): HandoffVerdict {
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'MALFORMED' };
  const [body, sig] = parts;
  if (!same(sig, hmac(secret, body))) return { ok: false, reason: 'BAD_SIGNATURE' };

  let claims: HandoffClaims;
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as HandoffClaims;
  } catch {
    return { ok: false, reason: 'MALFORMED' };
  }
  if (!claims || typeof claims.sub !== 'string' || typeof claims.exp !== 'number') {
    return { ok: false, reason: 'MALFORMED' };
  }

  const t = Math.floor(now.getTime() / 1000);
  // A minute of clock slack either way: two servers rarely agree to the second.
  if (t > claims.exp + 60) return { ok: false, reason: 'EXPIRED' };
  if (claims.iat > t + 60) return { ok: false, reason: 'NOT_YET' };
  return { ok: true, claims };
}

/* Results coming back ---------------------------------------------------- */

/**
 * The signature the partner puts on a result: HMAC over `<timestamp>.<raw body>`.
 * The timestamp is in the header too, and refused when it is more than five
 * minutes old, so a captured request cannot be replayed a week later.
 */
export function signResultBody(rawBody: string, secret: string, timestamp: number): string {
  return hmac(secret, `${timestamp}.${rawBody}`);
}

export function verifyResultSignature(input: {
  rawBody: string;
  secret: string;
  signature: string | null | undefined;
  timestamp: string | number | null | undefined;
  now: Date;
}): { ok: true } | { ok: false; reason: 'MISSING' | 'STALE' | 'BAD_SIGNATURE' } {
  if (!input.signature || input.timestamp === null || input.timestamp === undefined) {
    return { ok: false, reason: 'MISSING' };
  }
  const ts = Number(input.timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: 'MISSING' };
  if (Math.abs(Math.floor(input.now.getTime() / 1000) - ts) > 300) return { ok: false, reason: 'STALE' };
  return same(input.signature, signResultBody(input.rawBody, input.secret, ts))
    ? { ok: true }
    : { ok: false, reason: 'BAD_SIGNATURE' };
}

/** What a partner sends back. Anything else in the body is kept as detail. */
export interface PartnerResultPayload {
  externalId: string;
  /** Our user id, from the handoff's `sub`. */
  userId: string;
  title: string;
  level?: string | null;
  scorePercent?: number | null;
  passed?: boolean | null;
  takenAt: string;
  certificateUrl?: string | null;
  modules?: { name: string; score: number; max: number }[];
}

export function parseResultPayload(raw: unknown): { ok: true; result: PartnerResultPayload } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'The body is not an object.' };
  const r = raw as Record<string, unknown>;
  const str = (k: string) => (typeof r[k] === 'string' ? (r[k] as string).trim() : '');
  if (!str('externalId')) return { ok: false, error: 'externalId is required.' };
  if (!str('userId')) return { ok: false, error: 'userId is required.' };
  if (!str('title')) return { ok: false, error: 'title is required.' };
  const takenAt = new Date(str('takenAt'));
  if (Number.isNaN(takenAt.getTime())) return { ok: false, error: 'takenAt must be an ISO date.' };

  const score = r.scorePercent === undefined || r.scorePercent === null ? null : Number(r.scorePercent);
  if (score !== null && (!Number.isFinite(score) || score < 0 || score > 100)) {
    return { ok: false, error: 'scorePercent must be between 0 and 100.' };
  }

  const modules = Array.isArray(r.modules)
    ? r.modules
        .map((m) => m as Record<string, unknown>)
        .filter((m) => m && typeof m.name === 'string')
        .map((m) => ({ name: String(m.name).slice(0, 80), score: Number(m.score) || 0, max: Number(m.max) || 0 }))
    : undefined;

  return {
    ok: true,
    result: {
      externalId: str('externalId').slice(0, 120),
      userId: str('userId'),
      title: str('title').slice(0, 160),
      level: str('level') || null,
      scorePercent: score,
      passed: typeof r.passed === 'boolean' ? r.passed : null,
      takenAt: takenAt.toISOString(),
      certificateUrl: /^https:\/\//.test(str('certificateUrl')) ? str('certificateUrl').slice(0, 500) : null,
      modules,
    },
  };
}
