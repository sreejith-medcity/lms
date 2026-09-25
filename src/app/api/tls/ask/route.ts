import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { runAsPlatform } from '@/lib/db-scope';
import { legacyHosts } from '@/lib/exams/legacy';

export const dynamic = 'force-dynamic';

/**
 * Whether Caddy may get a certificate for a hostname.
 *
 * On the VPS, Caddy issues certificates on demand: the first request for a
 * name it has no certificate for makes it ask here, and it issues one only
 * on a 200. That is what lets an academy's own domain work the moment its
 * DNS points at us, with no certificate step, and what stops a stranger
 * pointing a thousand names at the box and running the issuer's limits
 * down: a name is allowed only when it is a known academy address, an
 * academy under the base domain, or the platform host.
 *
 *   caddy: on_demand_tls { ask http://127.0.0.1:3000/api/tls/ask }
 */
export async function GET(request: Request) {
  const domain = (new URL(request.url).searchParams.get('domain') ?? '').trim().toLowerCase();
  if (!/^[a-z0-9.-]{1,253}$/.test(domain)) return new NextResponse('no', { status: 400 });

  const base = (process.env.APP_BASE_DOMAIN ?? '').split(':')[0].toLowerCase();
  const platformHost = (process.env.PLATFORM_HOST ?? (base ? `admin.${base}` : '')).split(':')[0].toLowerCase();
  const headers = { 'cache-control': 'no-store' };

  if (platformHost && domain === platformHost) return new NextResponse('ok', { status: 200, headers });
  if (base && (domain === base || domain === `www.${base}`)) return new NextResponse('ok', { status: 200, headers });
  if (legacyHosts(process.env.TESTS_LEGACY_HOSTS).includes(domain)) return new NextResponse('ok', { status: 200, headers });

  const known = await runAsPlatform(async () => {
    const named = await db.tenantDomain.findUnique({ where: { hostname: domain }, select: { id: true } });
    if (named) return true;
    if (base && domain.endsWith(`.${base}`)) {
      const slug = domain.slice(0, -1 * (base.length + 1));
      if (slug && !slug.includes('.')) {
        const tenant = await db.tenant.findUnique({ where: { slug }, select: { id: true } });
        return Boolean(tenant);
      }
    }
    return false;
  });
  return new NextResponse(known ? 'ok' : 'no', { status: known ? 200 : 404, headers });
}
