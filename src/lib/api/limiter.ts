/**
 * A small in-memory limiter, per process: enough to blunt a credential
 * stuffer on one box. The OTP path has its own cooldown in the database.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function limited(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 10_000) for (const [k, v] of buckets) if (v.resetAt < now) buckets.delete(k);
    return false;
  }
  b.count += 1;
  return b.count > max;
}
