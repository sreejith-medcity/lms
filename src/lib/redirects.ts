import { db } from '@/lib/db';
import { normalisePath } from '@/lib/paths';

/**
 * Keeping the old URLs alive.
 *
 * This is the part of a migration that cannot be fixed afterwards. Rankings
 * built over years live on specific paths, and a store that disappears into
 * 404s loses them in weeks and takes months to win back, if ever. Everything
 * else in this build can be corrected on a Tuesday; this cannot.
 *
 * The rules for reading and comparing paths live in `paths.ts`, which has no
 * database import and is therefore testable on its own. This file is the part
 * that goes looking in the table.
 */

export { normalisePath, parseRules, type ParsedRule } from '@/lib/paths';

export interface Match {
  toPath: string;
  statusCode: number;
  id: string;
}

export async function findRedirect(
  organizationId: string,
  rawPath: string,
): Promise<Match | null> {
  const fromPath = normalisePath(rawPath);

  const exact = await db.redirect.findUnique({
    where: { organizationId_fromPath: { organizationId, fromPath } },
    select: { id: true, toPath: true, statusCode: true },
  });
  if (exact) return exact;

  /**
   * A wildcard, for a whole tree at once. `/shop/*` moves everything under it,
   * which is how one row replaces the four hundred product URLs a WooCommerce
   * store accumulates. The longest matching prefix wins, so a specific rule can
   * still override the sweep it sits inside.
   */
  const segments = fromPath.split('/').filter(Boolean);
  const prefixes: string[] = [];
  for (let i = segments.length; i > 0; i -= 1) {
    prefixes.push(`/${segments.slice(0, i).join('/')}/*`);
  }
  prefixes.push('/*');

  if (!prefixes.length) return null;

  const wildcards = await db.redirect.findMany({
    where: { organizationId, fromPath: { in: prefixes } },
    select: { id: true, fromPath: true, toPath: true, statusCode: true },
  });
  if (!wildcards.length) return null;

  const best = wildcards.sort((a, b) => b.fromPath.length - a.fromPath.length)[0];

  // A destination ending in /* carries the rest of the path across, so
  // /shop/* -> /courses/* turns /shop/ielts-kochi into /courses/ielts-kochi.
  if (best.toPath.endsWith('/*')) {
    const prefix = best.fromPath.slice(0, -2);
    const rest = fromPath.slice(prefix.length);
    return {
      id: best.id,
      statusCode: best.statusCode,
      toPath: `${best.toPath.slice(0, -2)}${rest}`,
    };
  }

  return { id: best.id, toPath: best.toPath, statusCode: best.statusCode };
}

/**
 * Counted, but never in the way of the response.
 *
 * A visitor waiting on a write before they are redirected is a visitor waiting
 * for nothing. If the count is lost the redirect still happened, which is the
 * right trade.
 */
export function countHit(id: string): void {
  db.redirect
    .update({ where: { id }, data: { hitCount: { increment: 1 } } })
    .catch(() => {
      /* A missed count is not worth an error page. */
    });
}

