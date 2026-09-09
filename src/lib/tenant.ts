import { headers } from 'next/headers';
import { cache } from 'react';
import { db } from '@/lib/db';

export const TENANT_HEADER = 'x-tenant-id';
export const HOST_HEADER = 'x-tenant-host';

export interface TenantContext {
  tenantId: string;
  organizationId: string;
  slug: string;
  name: string;
  brandColor: string;
  logoUrl: string | null;
  currency: string;
  timezone: string;
  status: string;
  features: Record<string, boolean>;
}

/**
 * Resolved once per request from the hostname that middleware stamped on the
 * headers. Every query below this point is scoped by organizationId.
 */
export const getTenantContext = cache(async (): Promise<TenantContext | null> => {
  const h = await headers();
  const tenantId = h.get(TENANT_HEADER) ?? (await resolveTenantByHost(h.get('host') ?? ''));
  if (!tenantId) return null;

  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    include: {
      organizations: { take: 1 },
      subscription: { include: { plan: { include: { features: true } } } },
      entitlements: true,
    },
  });

  const org = tenant?.organizations[0];
  if (!tenant || !org) return null;

  const features: Record<string, boolean> = {};
  for (const f of tenant.subscription?.plan.features ?? []) features[f.feature] = f.enabled;
  for (const e of tenant.entitlements) {
    if (e.feature && e.enabled != null) features[e.feature] = e.enabled;
  }

  return {
    tenantId: tenant.id,
    organizationId: org.id,
    slug: tenant.slug,
    name: org.name,
    brandColor: org.brandColor,
    logoUrl: org.logoUrl,
    currency: org.currency,
    timezone: org.timezone,
    status: tenant.status,
    features,
  };
});

export async function requireTenant(): Promise<TenantContext> {
  const ctx = await getTenantContext();
  if (!ctx) throw new Error('No tenant resolved for this request');
  return ctx;
}

/** Look a tenant up by the hostname the request arrived on. */
export async function resolveTenantByHost(host: string) {
  const hostname = host.split(':')[0].toLowerCase();

  const domain = await db.tenantDomain.findUnique({
    where: { hostname },
    select: { tenantId: true },
  });
  if (domain) return domain.tenantId;

  const base = (process.env.APP_BASE_DOMAIN ?? '').split(':')[0].toLowerCase();
  if (base && hostname.endsWith(`.${base}`)) {
    const slug = hostname.slice(0, -1 * (base.length + 1));
    const tenant = await db.tenant.findUnique({ where: { slug }, select: { id: true } });
    return tenant?.id ?? null;
  }
  return null;
}
