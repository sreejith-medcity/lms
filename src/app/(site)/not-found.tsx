import Link from 'next/link';
import { db } from '@/lib/db';
import { getTenantContext } from '@/lib/tenant';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Page not found',
  robots: { index: false, follow: true },
};

/**
 * Where a dead link lands.
 *
 * This page matters more during a migration than at any other time. Years of
 * links live on the old store's URLs: in Google, in WhatsApp forwards, in
 * counsellors' saved messages, on printed flyers. The redirect map catches the
 * ones we anticipated; this catches the rest, and the difference between a
 * useful answer and Next's stock "404: This page could not be found." is
 * measured in enrolments.
 *
 * So it offers the three things somebody arriving here actually wants: a
 * search, the courses that exist, and a way to ask a person. It stays
 * `noindex, follow`, which is right for a page that should never rank but
 * whose links should still be crawled.
 */
export default async function NotFound() {
  const tenant = await getTenantContext();

  const courses = tenant
    ? await db.product.findMany({
        where: {
          organizationId: tenant.organizationId,
          type: 'COURSE',
          status: 'PUBLISHED',
          deletedAt: null,
        },
        orderBy: [{ isFeatured: 'desc' }, { createdAt: 'desc' }],
        take: 6,
        select: { slug: true, title: true },
      })
    : [];

  return (
    <div className="mx-auto max-w-3xl px-5 py-16 sm:py-24">
      <p className="t-small muted">Page not found</p>
      <h1 className="t-display mt-2">That page has moved, or never existed.</h1>
      <p className="muted mt-4 max-w-prose">
        If you followed a link from an older version of this site, the course is probably still
        here under a new address. Search for it, or pick it out below.
      </p>

      <form action="/courses" method="get" className="mt-8 flex max-w-md gap-2">
        <label htmlFor="notfound-search" className="sr-only">
          Search courses
        </label>
        <input
          id="notfound-search"
          type="search"
          name="q"
          placeholder="IELTS, German, OET..."
          className="w-full rounded-[var(--radius-sm)] border bg-[var(--surface)] px-4 py-2.5 text-sm"
        />
        <button
          type="submit"
          className="rounded-[var(--radius-sm)] bg-[var(--brand)] px-4 py-2.5 text-sm font-medium text-[var(--brand-ink)]"
        >
          Search
        </button>
      </form>

      {courses.length > 0 && (
        <section className="mt-10">
          <h2 className="t-heading">Courses running now</h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {courses.map((course) => (
              <li key={course.slug}>
                <Link
                  href={`/course/${course.slug}`}
                  className="block rounded-[var(--radius-sm)] border bg-[var(--surface)] px-4 py-3 text-sm transition hover:bg-[var(--surface-2)]"
                >
                  {course.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="t-small muted mt-10">
        Still stuck?{' '}
        <Link href="/courses" className="underline">
          Browse every course
        </Link>{' '}
        or{' '}
        <Link href="/contact" className="underline">
          ask us where it went
        </Link>
        .
      </p>
    </div>
  );
}
