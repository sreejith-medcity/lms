import type { MetadataRoute } from 'next';
import { canonicalHost } from '@/lib/canonical-host';

export const dynamic = 'force-dynamic';

/**
 * What a crawler may read.
 *
 * Two rules. Application surfaces are never useful in a search result and
 * some of them are private, so they are closed on every host. And a host
 * that is not this academy's primary domain is closed entirely: while a site
 * is being built on one name and destined for another, an indexed rehearsal
 * competes with the real thing and splits the links between them.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const { host, primary, isCanonical } = await canonicalHost();

  if (!isCanonical) {
    return {
      rules: [{ userAgent: '*', disallow: '/' }],
      // Still point at the real one, so a crawler that arrived here is told
      // where the site actually lives.
      sitemap: `https://${primary}/sitemap.xml`,
    };
  }

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin', '/learn', '/platform', '/api', '/media', '/login', '/signup', '/logout'],
      },
    ],
    sitemap: `https://${host}/sitemap.xml`,
  };
}
