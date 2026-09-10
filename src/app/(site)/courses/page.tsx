import type { Metadata } from 'next';
import { db } from '@/lib/db';
import { getSiteContext } from '@/lib/site';
import { NoTenantNotice } from '@/components/tenant-notices';
import { Catalogue } from './catalogue';
import { CatalogueHero } from './hero';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const site = await getSiteContext();
  return {
    title: site ? `All courses — ${site.organization.name}` : 'Courses',
    description: 'Every course, with its format, level, batch dates and price.',
    alternates: { canonical: '/courses' },
  };
}

export default async function CoursesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const site = await getSiteContext();
  if (!site) return <NoTenantNotice />;

  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k]) as string | undefined;
  const filters = {
    q: one('q'),
    level: one('level'),
    format: one('format'),
    sort: one('sort'),
  };

  // Counted rather than claimed. A storefront that says "500+ learners" with
  // nothing behind it is the thing this product is replacing.
  const [courseCount, liveCount] = await Promise.all([
    db.product.count({
      where: {
        organizationId: site.organizationId,
        type: 'COURSE',
        status: 'PUBLISHED',
        deletedAt: null,
      },
    }),
    db.batch.count({
      where: {
        organizationId: site.organizationId,
        status: { in: ['UPCOMING', 'ACTIVE'] },
        deletedAt: null,
      },
    }),
  ]);

  const stats = [
    { label: 'Published courses', value: String(courseCount) },
    { label: 'Batches running or opening', value: String(liveCount) },
    { label: 'Subjects', value: String(site.categories.length) },
  ].filter((s) => s.value !== '0');

  return (
    <>
      <CatalogueHero
        eyebrow="Course catalogue"
        title="Find the course that gets you to the next thing"
        blurb="Live classes with a trainer, recorded lessons you work through in your own time, or both together. Batch dates come from the live schedule, so what you see here is what is actually running."
        action="/courses"
        hidden={{ level: filters.level, format: filters.format, sort: filters.sort }}
        q={filters.q}
        stats={stats}
      />

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
        <Catalogue
          organizationId={site.organizationId}
          categories={site.categories}
          filters={filters}
        />
      </div>
    </>
  );
}
