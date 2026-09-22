import { PrismaClient } from '@prisma/client';
import { withRowScope } from '@/lib/db-rls';
import { explicitScope, scopeSetting } from '@/lib/db-scope';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const base =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = base;

/**
 * The academy a request belongs to, by the host it arrived on, kept for a
 * minute so the scope costs a query once per host rather than once per
 * query. The lookups use the bare client: the tables they read (domains,
 * tenants, organisations) are the platform's, outside every policy, and a
 * scoped client would ask for the scope it is trying to find.
 */
const hosts = new Map<string, { organizationId: string | null; until: number }>();
const HOST_TTL_MS = 60_000;

async function organizationForHost(host: string): Promise<string | null> {
  const known = hosts.get(host);
  if (known && known.until > Date.now()) return known.organizationId;

  let organizationId: string | null = null;
  const domain = await base.tenantDomain.findUnique({
    where: { hostname: host },
    select: { tenant: { select: { organizations: { take: 1, select: { id: true } } } } },
  });
  if (domain) {
    organizationId = domain.tenant.organizations[0]?.id ?? null;
  } else {
    const baseDomain = (process.env.APP_BASE_DOMAIN ?? '').split(':')[0].toLowerCase();
    if (baseDomain && host.endsWith(`.${baseDomain}`)) {
      const slug = host.slice(0, -1 * (baseDomain.length + 1));
      const tenant = await base.tenant.findUnique({ where: { slug }, select: { organizations: { take: 1, select: { id: true } } } });
      organizationId = tenant?.organizations[0]?.id ?? null;
    }
  }
  hosts.set(host, { organizationId, until: Date.now() + HOST_TTL_MS });
  return organizationId;
}

/**
 * What `app.scope` should say for the query about to run.
 *
 * An explicit scope (`runAsPlatform`, `runAsOrganization`) wins. Otherwise
 * the request decides: the platform host is the platform; an academy's host
 * is that academy; a host that is nobody's sees nothing. Outside a request
 * (the seed, a script, a test) there is nobody to hide anything from.
 * Whether the platform host is the platform is decided from the host itself,
 * never from a header a client could send.
 */
async function requestScope(): Promise<string> {
  const explicit = explicitScope();
  if (explicit) return scopeSetting(explicit);

  const h = await requestHeaders();
  if (!h) return 'platform';
  const host = (h.get('host') ?? '').split(':')[0].toLowerCase();
  const baseDomain = (process.env.APP_BASE_DOMAIN ?? 'localhost').split(':')[0].toLowerCase();
  const platformHost = (process.env.PLATFORM_HOST ?? `admin.${baseDomain}`).split(':')[0].toLowerCase();
  if (host && host === platformHost) return 'platform';

  const organizationId = host ? await organizationForHost(host) : null;
  return organizationId ? `tenant:${organizationId}` : 'none';
}

/**
 * The request's headers, from `next/headers`, loaded when first needed
 * rather than imported at the top. This module sits under a few constants
 * that client components import (a field-type list from a lib file that
 * also queries), and a static import of `next/headers` anywhere in a
 * client component's import graph fails the build. The comments keep the
 * bundler from following the import; on the server Node resolves it as
 * usual, and in the browser this code never runs. Outside a request
 * (`headers()` throws) there is nobody to hide anything from.
 */
type HeadersModule = { headers: () => Promise<{ get(name: string): string | null }> };
let headersModule: Promise<HeadersModule> | null = null;

async function requestHeaders(): Promise<{ get(name: string): string | null } | null> {
  const name = 'next/headers';
  headersModule ??= import(/* webpackIgnore: true */ /* turbopackIgnore: true */ name) as Promise<HeadersModule>;
  let mod: HeadersModule;
  try {
    mod = await headersModule;
  } catch (err) {
    // The module itself missing is a broken deployment, not "no request":
    // said out loud rather than quietly widening every query to everything.
    headersModule = null;
    throw new Error(`Row scope: next/headers could not be loaded (${err instanceof Error ? err.message : String(err)})`);
  }
  try {
    return await mod.headers();
  } catch {
    return null;
  }
}

/** `DATABASE_RLS=1` turns the scope on; see `docs` in `prisma/rls.sql` for the order to do it in. */
export const db: PrismaClient = withRowScope(base, {
  enabled: () => process.env.DATABASE_RLS === '1',
  resolve: requestScope,
});
