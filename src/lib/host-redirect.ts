/**
 * An address the academy has moved away from: every page on it is sent, for
 * good (308), to the same path and query on the new one.
 *
 *   HOST_REDIRECTS="demo.medcitylms.in=https://medcitylms.com"
 *
 * /api/ is left alone on purpose. Webhooks (Razorpay, Zoom), the phone app
 * and the cron jobs call it with a body or a bearer token, and a client that
 * follows a redirect to another host drops the token or the body; those
 * callers keep working on the old name until each is pointed at the new one.
 * Pure, so the middleware can use it and a test can pin it.
 */

export function parseHostRedirects(value: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const pair of (value ?? '').split(',')) {
    const [from, to] = pair.split('=').map((x) => (x ?? '').trim());
    if (!from || !to) continue;
    const target = to.replace(/\/+$/, '');
    if (!/^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(target)) continue;
    out.set(from.toLowerCase(), target);
  }
  return out;
}

export function hostRedirect(hostname: string, pathname: string, search: string, value: string | undefined): string | null {
  if (pathname.startsWith('/api/') || pathname.startsWith('/_next/')) return null;
  const target = parseHostRedirects(value).get(hostname.toLowerCase());
  if (!target) return null;
  if (new URL(target).hostname === hostname.toLowerCase()) return null;
  return `${target}${pathname}${search}`;
}
