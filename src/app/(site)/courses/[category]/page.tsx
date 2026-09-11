import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { getSiteContext } from '@/lib/site';
import { NoTenantNotice } from '@/components/tenant-notices';
import { Catalogue } from '../catalogue';
import { CatalogueHeading } from '../hero';

export const dynamic = 'force-dynamic';

async function category(slug: string) {
  const site = await getSiteContext();
  if (!site) return null;
  const found = await db.category.findFirst({
    where: { organizationId: site.organizationId, slug, isActive: true },
    select: { name: true, slug: true, tagline: true },
  });
  return found ? { site, category: found } : null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>;
}): Promise<Metadata> {
  const found = await category((await params).category);
  if (!found) return { title: 'Not found' };
  return {
    title: `${found.category.name} courses — ${found.site.organization.name}`,
    description: `${found.category.name} courses with live classes, recorded lessons and batch dates.`,
    alternates: { canonical: `/courses/${found.category.slug}` },
  };
}

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ category: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const site = await getSiteContext();
  if (!site) return <NoTenantNotice />;

  const { category: slug } = await params;
  const found = await category(slug);
  if (!found) notFound();

  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k]) as string | undefined;
  const filters = {
    q: one('q'),
    category: slug,
    level: one('level'),
    format: one('format'),
    language: one('language'),
    price: one('price'),
    sort: one('sort'),
    page: one('page'),
  };

  return (
    <div className="mx-auto max-w-[80rem] px-4 py-8 sm:px-6 sm:py-10">
      <CatalogueHeading
        crumb={{ href: '/courses', label: 'All courses' }}
        title={`${found.category.name} courses`}
        blurb={found.category.tagline ?? `Every published ${found.category.name.toLowerCase()} course, with its format, level, batch dates and price.`}
        q={filters.q}
      />
      <Catalogue
        organizationId={site.organizationId}
        categories={site.categories}
        basePath={`/courses/${slug}`}
        filters={filters}
      />
    </div>
  );
}
