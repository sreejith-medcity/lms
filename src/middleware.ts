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
/**
 * Public pages a CDN may hold, and the reason each one is on the list.
 *
 * Every page here renders identically for a signed-in visitor and a stranger.
 * That is the whole test, and it is why the account link in the header moved
 * into the browser: one server-rendered "Admin" link made every public page
 * per-user, and a page that differs per user cannot be cached for anybody.
 *
 * `/course/<slug>` is on the list now. Its purchase panel used to show whether
 * you were enrolled and what your points were worth, which made the most
 * search-valuable page in the product the only public one that could not be
 * cached. That corner is fetched by the browser after the page arrives, so the
 * page itself is the same for everybody.
 */
const CACHEABLE = [
  /^\/$/,
  /^\/courses(\/[\w-]+)?$/,
  /^\/course\/[\w-]+$/,
  /^\/about$/,
  /^\/contact$/,
  /^\/help$/,
  /^\/policies\/[\w-]+$/,
  /^\/blog(\/[\w-]+)?$/,
];

/** A minute at the edge, and up to ten more while the origin catches up. */
const PUBLIC_CACHE = 'public, s-maxage=60, stale-while-revalidate=600';

function mayCache(req: NextRequest): boolean {
  if (req.method !== 'GET') return false;

  // Somebody signed in gets the live page. They are a handful of people, they
  // are the ones who notice staleness, and it keeps a session cookie from ever
  // being the thing that decides what lands in a shared cache.
  if (req.cookies.has('mlms_session')) return false;

  const path = req.nextUrl.pathname;
  return CACHEABLE.some((pattern) => pattern.test(path));
}

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

  if (mayCache(req)) {
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set('Cache-Control', PUBLIC_CACHE);
    // Without this a cache could hand the same entry to a different academy on
    // a different hostname, which is the one way this could go badly wrong.
    response.headers.set('Vary', 'Host, Accept-Encoding');
    return response;
  }

  // Subdomain slug is a cheap hint; the DB lookup confirms it downstream.
  if (hostname.endsWith(`.${base}`)) {
    requestHeaders.set('x-tenant-slug', hostname.slice(0, -1 * (base.length + 1)));
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|assets|media/).*)'],
};
