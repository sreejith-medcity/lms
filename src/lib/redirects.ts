import { db } from '@/lib/db';

/**
 * Keeping the old URLs alive.
 *
 * This is the part of a migration that cannot be fixed afterwards. Rankings
 * built over years live on specific paths, and a store that disappears into
 * 404s loses them in weeks and takes months to win back, if ever. Everything
 * else in this build can be corrected on a Tuesday; this cannot.
 *
 * So a redirect is data an academy can add, not a constant in a config file,
 * and every hit is counted, because the only way to know the map is complete is
 * to watch which old paths are still being asked for.
 */

/**
 * One shape for a path, so `/Courses/IELTS/` and `/courses/ielts` are the same
 * key. WordPress serves both, and a map that only matches one of them is a map
 * with holes in it.
 */
export function normalisePath(raw: string): string {
  let path = raw.trim();
  if (!path) return '/';

  // A full URL may be pasted in from a spreadsheet or a Search Console export.
  if (/^https?:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      /* Leave it as typed and let the rest of the cleaning deal with it. */
    }
  }

  path = path.split('#')[0].split('?')[0];
  if (!path.startsWith('/')) path = `/${path}`;
  path = path.toLowerCase().replace(/\/{2,}/g, '/');

  // Trailing slash removed, except for the root itself.
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);

  return path;
}

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

export interface ParsedRule {
  fromPath: string;
  toPath: string;
  statusCode: number;
  error?: string;
}

/**
 * Reading a pasted list.
 *
 * Accepts what people actually have: a CSV export, a column pair out of a
 * spreadsheet, or two URLs separated by a space. Anything unparseable is
 * returned as a row with a reason rather than silently dropped, because a
 * redirect that was quietly skipped is a 404 nobody knows about.
 */
export function parseRules(text: string): ParsedRule[] {
  const out: ParsedRule[] = [];

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const parts = trimmed.split(/[,\t]|\s{2,}|\s+/).filter(Boolean);

    if (parts.length < 2) {
      out.push({
        fromPath: trimmed,
        toPath: '',
        statusCode: 301,
        error: 'Needs an old path and a new one.',
      });
      continue;
    }

    const [from, to, status] = parts;
    const code = Number(status);

    const fromPath = from.endsWith('/*') ? `${normalisePath(from.slice(0, -2))}/*` : normalisePath(from);
    const toPath = to.endsWith('/*') ? `${normalisePath(to.slice(0, -2))}/*` : normalisePath(to);

    if (fromPath === toPath) {
      out.push({ fromPath, toPath, statusCode: 301, error: 'That points at itself.' });
      continue;
    }

    out.push({
      fromPath,
      toPath,
      statusCode: code === 302 || code === 307 ? code : 301,
    });
  }

  return out;
}
