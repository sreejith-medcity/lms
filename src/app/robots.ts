import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

export default async function robots(): Promise<MetadataRoute.Robots> {
  const host = (await headers()).get('host') ?? '';
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Application surfaces. Nothing here is useful in a search result, and
        // some of it is private.
        disallow: ['/admin', '/learn', '/platform', '/api', '/media', '/login', '/signup', '/logout'],
      },
    ],
    sitemap: `https://${host}/sitemap.xml`,
  };
}
