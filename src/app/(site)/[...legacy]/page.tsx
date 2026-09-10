import type { Metadata } from 'next';
import { permanentRedirect, redirect, notFound, RedirectType } from 'next/navigation';
import { db } from '@/lib/db';
import { getSiteContext } from '@/lib/site';
import { NoTenantNotice } from '@/components/tenant-notices';
import { findRedirect, countHit } from '@/lib/redirects';
import { parseBlocks, pageSummary } from '@/lib/page-blocks';
import { PageBlocks } from '@/components/page-blocks';
import CoursePage from '@/app/(site)/course/[slug]/page';

export const dynamic = 'force-dynamic';

/**
 * Everything the app did not claim for itself.
 *
 * Next matches a catch-all only when nothing more specific did, so this runs
 * exactly where a 404 would otherwise be rendered. Two things live here, in
 * order, and both exist because of the migration.
 *
 * First, the old store's own addresses. medcitylms.in has been selling from
 * /nclex-rn-course/ and its siblings for years, and those paths are in
 * Google, in ad campaigns, in WhatsApp forwards and on printed flyers. A
 * storefront page holds the address and says which course it belongs to, and
 * this route serves the real course page at it, with the marketing copy from
 * the old page inside it. The page keeps its address rather than being
 * redirected, because a redirect leaks a little of all of that every time.
 *
 * Second, the redirect map, for the paths that have no equivalent here: 308
 * for a permanent rule, which is what Next issues and what search engines
 * treat as a 301, and 307 while something is being moved.
 *
 * Anything matching neither still gets a 404, which the not-found page turns
 * into a search and a list of courses rather than a dead end.
 */

async function resolve(segments: string[]) {
  const site = await getSiteContext();
  if (!site) return { site: null, page: null } as const;

  // Only a single segment can be a page of ours: every storefront address is
  // one word deep, and /a/b coming back as the page at /a would be wrong.
  if (segments.length !== 1) return { site, page: null } as const;

  const page = await db.storefrontPage.findFirst({
    where: { organizationId: site.organizationId, slug: segments[0], status: 'PUBLISHED' },
    select: {
      slug: true,
      title: true,
      kind: true,
      blocks: true,
      seoTitle: true,
      seoDescription: true,
      course: { select: { product: { select: { slug: true } } } },
    },
  });

  return { site, page } as const;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ legacy: string[] }>;
}): Promise<Metadata> {
  const { legacy } = await params;
  const { site, page } = await resolve(legacy ?? []);
  if (!site || !page) return { title: 'Page not found', robots: { index: false, follow: true } };

  const description = page.seoDescription ?? pageSummary(parseBlocks(page.blocks)) ?? undefined;

  return {
    title: page.seoTitle ?? `${page.title} — ${site.organization.name}`,
    description,
    alternates: { canonical: `/${page.slug}` },
    openGraph: { title: page.title, description, type: 'website' },
  };
}

export default async function LegacyPath({
  params,
}: {
  params: Promise<{ legacy: string[] }>;
}) {
  const { legacy } = await params;
  const segments = legacy ?? [];
  const { site, page } = await resolve(segments);
  if (!site) return <NoTenantNotice />;

  if (!page) {
    const path = `/${segments.join('/')}`;
    const match = await findRedirect(site.organizationId, path);
    if (!match) notFound();

    countHit(match.id);
    if (match.statusCode === 301 || match.statusCode === 308) permanentRedirect(match.toPath);
    redirect(match.toPath, RedirectType.replace);
  }

  /*
   * A course landing page is not a second kind of page: it is the course
   * page, at the address the course was always sold from. Rendering the same
   * component rather than a copy of it is what stops the two drifting apart,
   * which is what happened on the old site, where the landing pages had no
   * way to buy anything and the product pages had none of the words.
   */
  if (page.kind === 'COURSE_LANDING' && page.course?.product.slug) {
    return CoursePage({ params: Promise.resolve({ slug: page.course.product.slug }) });
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <h1 className="t-display">{page.title}</h1>
      <div className="mt-8">
        <PageBlocks blocks={parseBlocks(page.blocks)} ctaHref="/courses" />
      </div>
    </div>
  );
}
