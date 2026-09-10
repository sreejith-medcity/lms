import Link from 'next/link';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { parseBlocks } from '@/lib/page-blocks';
import { toBlockSource } from '@/lib/block-source';
import { LandingEditor } from './editor';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * Where the old store's marketing pages are brought over.
 *
 * One screen, because there is one job: point at a page on the old site,
 * read what comes back, fix it, and publish it at the address it already
 * had. The content lands on the course page rather than on a page of its
 * own, so the words and the buy button are finally in the same place.
 */
export default async function LandingPages({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireTenant();
  await requireStaff('blogs.manage_blogs', 'view');

  const sp = await searchParams;
  const editing = (Array.isArray(sp.course) ? sp.course[0] : sp.course) as string | undefined;

  const courses = await db.course.findMany({
    where: { organizationId: tenant.organizationId, product: { deletedAt: null } },
    orderBy: { product: { title: 'asc' } },
    select: {
      id: true,
      product: { select: { title: true, slug: true, status: true } },
      landingPage: {
        select: {
          id: true,
          slug: true,
          title: true,
          status: true,
          blocks: true,
          seoTitle: true,
          seoDescription: true,
          updatedAt: true,
        },
      },
    },
  });

  const current = courses.find((c) => c.id === editing) ?? courses[0];
  const page = current?.landingPage;

  return (
    <div>
      <PageHeader
        title="Course landing pages"
        description="The marketing pages from the old store, kept at their own addresses. Import one, read what came across, then publish it: it renders as the course page, so the words that sell the course sit above a purchase card that works."
      />

      {courses.length === 0 ? (
        <EmptyState
          title="No courses yet"
          hint="A landing page belongs to a course, so create the course first."
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <section>
            <h2 className="t-heading mb-3">Courses</h2>
            <ul className="space-y-2">
              {courses.map((c) => (
                <li key={c.id}>
                  <Card>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link
                          href={`/admin/storefront/landing?course=${c.id}`}
                          className={`font-medium hover:underline ${c.id === current?.id ? 'underline' : ''}`}
                        >
                          {c.product.title}
                        </Link>
                        <p className="t-small faint mt-1 font-mono">
                          {c.landingPage ? `/${c.landingPage.slug}` : `/course/${c.product.slug}`}
                        </p>
                      </div>
                      {c.landingPage ? (
                        <Badge tone={c.landingPage.status === 'PUBLISHED' ? 'ok' : 'neutral'}>
                          {c.landingPage.status === 'PUBLISHED'
                            ? `${parseBlocks(c.landingPage.blocks).length} sections`
                            : 'draft'}
                        </Badge>
                      ) : (
                        <Badge tone="neutral">none</Badge>
                      )}
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          </section>

          <section>
            {current && (
              <LandingEditor
                key={current.id}
                course={{
                  id: current.id,
                  title: current.product.title,
                  slug: current.product.slug,
                }}
                page={
                  page
                    ? {
                        slug: page.slug,
                        title: page.title,
                        status: page.status,
                        seoTitle: page.seoTitle,
                        seoDescription: page.seoDescription,
                        source: toBlockSource(parseBlocks(page.blocks)),
                      }
                    : undefined
                }
              />
            )}
          </section>
        </div>
      )}
    </div>
  );
}
