import { permanentRedirect, redirect, notFound, RedirectType } from 'next/navigation';
import { getTenantContext } from '@/lib/tenant';
import { findRedirect, countHit } from '@/lib/redirects';

export const dynamic = 'force-dynamic';

/**
 * The last route tried.
 *
 * Next matches a catch-all only when nothing more specific did, so this runs
 * exactly where a 404 would otherwise be rendered. That makes it the right
 * place to ask whether the path used to be something: an old store URL gets a
 * 308 to its new home, and anything genuinely unknown still gets a 404 rather
 * than being quietly swallowed.
 *
 * 308 rather than 301 because that is what Next issues for a permanent
 * redirect, and search engines treat the two the same. A temporary rule gets a
 * 307, which is the honest answer while a page is being moved.
 */
export default async function LegacyPath({
  params,
}: {
  params: Promise<{ legacy: string[] }>;
}) {
  const [tenant, { legacy }] = await Promise.all([getTenantContext(), params]);
  if (!tenant) notFound();

  const path = `/${(legacy ?? []).join('/')}`;
  const match = await findRedirect(tenant.organizationId, path);

  if (!match) notFound();

  countHit(match.id);

  if (match.statusCode === 301 || match.statusCode === 308) {
    permanentRedirect(match.toPath);
  }
  redirect(match.toPath, RedirectType.replace);
}
