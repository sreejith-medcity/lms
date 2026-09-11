import type { Metadata } from 'next';
import { getSiteContext } from '@/lib/site';
import { NoTenantNotice } from '@/components/tenant-notices';
import { Catalogue } from './catalogue';
import { CatalogueHeading } from './hero';

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
    language: one('language'),
    price: one('price'),
    sort: one('sort'),
    page: one('page'),
  };

  return (
    <div className="mx-auto max-w-[80rem] px-4 py-8 sm:px-6 sm:py-10">
      <CatalogueHeading
        title="All courses"
        blurb="Live classes with a trainer, recorded lessons you work through in your own time, or both. Batch dates come from the live schedule."
        q={filters.q}
      />
      <Catalogue organizationId={site.organizationId} categories={site.categories} filters={filters} />
    </div>
  );
}
