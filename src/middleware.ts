import { NextResponse, type NextRequest } from 'next/server';
import { HOST_HEADER } from '@/lib/http-headers';

/**
 * Tenant resolution happens here, on every request, from the hostname.
 *   admin.<base>       -> platform control plane, no tenant
 *   <slug>.<base>      -> tenant by slug
 *   any custom domain  -> tenant by TenantDomain lookup (done in the route via
 *                         resolveTenantByHost, since middleware has no DB access
 *                         on the edge runtime)
 */
export function middleware(req: NextRequest) {
  const host = req.headers.get('host') ?? '';
  const hostname = host.split(':')[0].toLowerCase();
  const base = (process.env.APP_BASE_DOMAIN ?? 'localhost').split(':')[0].toLowerCase();
  const platformHost = (process.env.PLATFORM_HOST ?? `admin.${base}`).split(':')[0].toLowerCase();

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set(HOST_HEADER, hostname);

  if (hostname === platformHost) {
    requestHeaders.set('x-platform', '1');
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  // Subdomain slug is a cheap hint; the DB lookup confirms it downstream.
  if (hostname.endsWith(`.${base}`)) {
    requestHeaders.set('x-tenant-slug', hostname.slice(0, -1 * (base.length + 1)));
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|assets).*)'],
};
