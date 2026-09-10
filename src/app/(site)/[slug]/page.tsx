import type { Metadata } from 'next';
import { notFound, permanentRedirect, redirect, RedirectType } from 'next/navigation';
import { db } from '@/lib/db';
import { getSiteContext } from '@/lib/site';
import { NoTenantNotice } from '@/components/tenant-notices';
import { parseBlocks, pageSummary } from '@/lib/page-blocks';
import { PageBlocks } from '@/components/page-blocks';
import { findRedirect, countHit } from '@/lib/redirects';
import CoursePage from '@/app/(site)/course/[slug]/page';

export const dynamic = 'force-dynamic';

/**
 * The old store's own addresses, answered by this one.
 *
 * medcitylms.in has been selling from /nclex-rn-course/ and its siblings for
 * years. Those paths are in Google, in ad campaigns, in WhatsApp forwards and
 * on printed flyers, and a redirect leaks a little of all of it every time.
 * So the page keeps its address: a storefront page here holds the slug and
 * says which course it belongs to, and this route serves the real course page
 * at it, with the marketing copy from the old page inside it.
 *
 * Three answers live here, in order. A storefront page at this slug. Failing
 * that, a redirect rule, which is what the catch-all used to do alone and
 * still does for deeper paths. Failing both, a 404.
 */

async function resolve(slug: string) {
  const site = await getSiteContext();
  if (!site) return { site: null, page: null } as const;

  const page = await db.storefrontPage.findFirst({
    where: { organizationId: site.organizationId, slug, status: 'PUBLISHED' },
    select: {
      id: true,
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
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const { site, page } = await resolve(slug);
  if (!site || !page) return { title: 'Page not found', robots: { index: false, follow: true } };

  const blocks = parseBlocks(page.blocks);
  const description = page.seoDescription ?? pageSummary(blocks) ?? undefined;

  return {
    title: page.seoTitle ?? `${page.title} — ${site.organization.name}`,
    description,
    alternates: { canonical: `/${page.slug}` },
    openGraph: { title: page.title, description, type: 'website' },
  };
}

export default async function StorefrontSlugPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { site, page } = await resolve(slug);
  if (!site) return <NoTenantNotice />;

  if (!page) {
    // Not a page of ours. It may still be a path somebody once linked to.
    const match = await findRedirect(site.organizationId, `/${slug}`);
    if (!match) notFound();

    countHit(match.id);
    if (match.statusCode === 301 || match.statusCode === 308) permanentRedirect(match.toPath);
    redirect(match.toPath, RedirectType.replace);
  }

  /*
   * A course landing page is not a second kind of page: it is the course
   * page, at the address the course was always sold from. Rendering the same
   * component rather than a copy of it is what stops the two drifting apart,
   * which is exactly what happened on the old site, where the landing pages
   * had no way to buy anything and the product pages had none of the words.
   */
  if (page.kind === 'COURSE_LANDING' && page.course?.product.slug) {
    return CoursePage({ params: Promise.resolve({ slug: page.course.product.slug }) });
  }

  const blocks = parseBlocks(page.blocks);

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <h1 className="t-display">{page.title}</h1>
      <div className="mt-8">
        <PageBlocks blocks={blocks} ctaHref="/courses" />
      </div>
    </div>
  );
}
