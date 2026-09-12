import { db } from '@/lib/db';

/**
 * The absolute address of an academy's site, for links inside messages
 * that leave from a scheduler rather than a request: an unsubscribe link,
 * a receipt link in a campaign. The primary domain if one is set, else the
 * first domain the tenant has, else the slug under the platform's base
 * domain.
 */
export async function organizationOrigin(organizationId: string): Promise<string> {
  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: {
      tenant: {
        select: {
          slug: true,
          domains: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }], take: 1, select: { hostname: true } },
        },
      },
    },
  });
  const host = organization?.tenant.domains[0]?.hostname;
  if (host) return `https://${host}`;
  const base = (process.env.APP_BASE_DOMAIN ?? '').split(':')[0].toLowerCase();
  if (organization?.tenant.slug && base) return `https://${organization.tenant.slug}.${base}`;
  return '';
}
