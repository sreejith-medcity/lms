import type { Metadata } from 'next';
import { getSiteContext } from '@/lib/site';
import { NoTenantNotice } from '@/components/tenant-notices';
import { Catalogue } from './catalogue';

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

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Courses</h1>
      <p className="t-small muted mt-1 max-w-prose">
        Prices are shown before applicable taxes. Batch dates come from the live schedule, so
        what you see here is what is actually running.
      </p>

      <div className="mt-8">
        <Catalogue
          organizationId={site.organizationId}
          categories={site.categories}
          filters={{ q: one('q'), level: one('level'), format: one('format'), sort: one('sort') }}
        />
      </div>
    </div>
  );
}
