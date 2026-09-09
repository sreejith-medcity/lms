import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Who is allowed to run the scheduled jobs.
 *
 * There is no scheduler in a Next.js app, so these are ordinary routes that
 * something outside calls: Hostinger's cron, a Vercel cron, or curl from a
 * laptop while somebody is debugging. That makes them URLs on the public
 * internet doing real work, so they need a secret, and it has to be compared in
 * constant time like any other.
 *
 * A missing secret refuses rather than allows. The opposite default is how an
 * open endpoint that drains an academy's message wallet ends up on the internet.
 */

export type CronCheck = { ok: true } | { ok: false; status: number; message: string };

export function authorizeCron(request: Request): CronCheck {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return {
      ok: false,
      status: 503,
      message: 'CRON_SECRET is not set, so scheduled jobs are switched off.',
    };
  }

  const header = request.headers.get('authorization') ?? '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const query = new URL(request.url).searchParams.get('key') ?? '';
  const supplied = bearer || query;

  if (!supplied) return { ok: false, status: 401, message: 'No key.' };

  // Hashed first so the comparison is over two equal-length buffers whatever
  // was supplied, which is what makes the constant-time comparison meaningful.
  const a = createHash('sha256').update(secret).digest();
  const b = createHash('sha256').update(supplied).digest();

  return timingSafeEqual(a, b) ? { ok: true } : { ok: false, status: 401, message: 'Wrong key.' };
}
