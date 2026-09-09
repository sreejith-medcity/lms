/**
 * Working out what a path means.
 *
 * Deliberately separate from `redirects.ts`, which reads the database. Nothing
 * here touches Prisma, so the rules that decide whether two URLs are the same
 * page can be tested on their own, on any machine, without a database anywhere
 * near them. That matters because this is the logic a migration hangs on and
 * the logic most likely to be quietly wrong.
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
