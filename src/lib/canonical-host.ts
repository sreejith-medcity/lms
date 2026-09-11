/**
 * Which hostname is the real one.
 *
 * An academy reaches this app on more than one name: a subdomain while it is
 * being built, its own domain once it goes live, sometimes both for weeks
 * while a migration settles. Only one of them should be in a search index.
 *
 * Two hosts serving the same pages is the quiet way to lose a rank: Google
 * picks one itself, often the wrong one, and the links pointing at the other
 * count for nothing. It matters here more than usual, because the plan is for
 * medcitylms.in to become this application, and a demo subdomain that has
 * been indexed for a month is then competing with the thing it was rehearsing
 * for.
 *
 * So the tenant's primary domain is the canonical one, and every other name
 * this app answers on says "do not index me". Switching the primary at
 * cutover moves the canonical, the sitemap and the indexing rule together,
 * because all three read this.
 */

import { cache } from 'react';
import { headers } from 'next/headers';
import { db } from '@/lib/db';
import { getTenantContext } from '@/lib/tenant';

export interface HostVerdict {
  /** The host this request arrived on. */
  host: string;
  /** The hostname this tenant should be indexed under, if one is set. */
  primary: string | null;
  /** True when the request is on the primary, or when none is set yet. */
  isCanonical: boolean;
  /** Absolute origin for canonical URLs and the sitemap. */
  origin: string;
}

export const canonicalHost = cache(async (): Promise<HostVerdict> => {
  const h = await headers();
  const host = (h.get('host') ?? '').split(':')[0].toLowerCase();
  const tenant = await getTenantContext();

  const primaryRow = tenant
    ? await db.tenantDomain.findFirst({
        where: { tenantId: tenant.tenantId, isPrimary: true },
        select: { hostname: true },
      })
    : null;

  const primary = primaryRow?.hostname?.toLowerCase() ?? null;

  // No primary set is the ordinary state of a site still being built. It is
  // not a reason to noindex everything, so the host that was asked for is
  // treated as its own canonical until somebody says otherwise.
  const isCanonical = !primary || primary === host;

  return {
    host,
    primary,
    isCanonical,
    origin: `https://${primary ?? host}`,
  };
});
