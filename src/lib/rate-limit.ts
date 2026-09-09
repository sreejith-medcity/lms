/**
 * Fixed-window rate limiting for the handful of endpoints an attacker can
 * hammer: sign in, sign up, password reset, OTP.
 *
 * The store is in-process on purpose. The app currently runs as a single
 * Node process on Hostinger, so a Map is accurate there and costs nothing.
 * It is deliberately behind an interface: when the app moves to more than one
 * instance, swap `store` for Redis or a Postgres table and nothing else in the
 * codebase changes. Anything that claims to rate limit across instances today
 * would be lying.
 */

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

interface Window {
  count: number;
  resetAt: number;
}

const store = new Map<string, Window>();

/** Windows are small; sweeping on write keeps the map from growing unbounded. */
function sweep(now: number) {
  if (store.size < 500) return;
  for (const [key, win] of store) if (win.resetAt <= now) store.delete(key);
}

export function rateLimit(key: string, limit: number, windowSeconds: number): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const existing = store.get(key);
  if (!existing || existing.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { ok: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));

  if (existing.count > limit) {
    return { ok: false, remaining: 0, retryAfterSeconds };
  }
  return { ok: true, remaining: limit - existing.count, retryAfterSeconds };
}

/** Clears a key after a success, so a correct password does not leave a near-full bucket. */
export function rateLimitReset(key: string) {
  store.delete(key);
}

/**
 * Two buckets per attempt: one for the client address, one for the identifier
 * being tried. The address bucket stops a scripted sweep; the identifier bucket
 * stops a distributed one from targeting a single account.
 */
export function authAttemptKeys(scope: string, tenantId: string, identifier: string, ip: string | null) {
  return [
    `${scope}:ip:${tenantId}:${ip ?? 'unknown'}`,
    `${scope}:id:${tenantId}:${identifier.toLowerCase()}`,
  ];
}

export function checkAll(keys: string[], limit: number, windowSeconds: number): RateLimitResult {
  let worst: RateLimitResult = { ok: true, remaining: limit, retryAfterSeconds: 0 };
  for (const key of keys) {
    const result = rateLimit(key, limit, windowSeconds);
    if (!result.ok || result.remaining < worst.remaining) worst = result;
  }
  return worst;
}

export function resetAll(keys: string[]) {
  for (const key of keys) rateLimitReset(key);
}

export function tooManyAttemptsMessage(retryAfterSeconds: number) {
  const minutes = Math.ceil(retryAfterSeconds / 60);
  return minutes <= 1
    ? 'Too many attempts. Try again in a minute.'
    : `Too many attempts. Try again in ${minutes} minutes.`;
}
