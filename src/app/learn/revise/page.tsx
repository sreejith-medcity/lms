import Link from 'next/link';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { standing } from '@/lib/revision';
import { Card, EmptyState } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Revise' };

/**
 * Every course the learner is on, with what is due on each. The one with
 * the most waiting comes first, because that is the one to open.
 */
export default async function ReviseHomePage() {
  const tenant = await requireTenant();
  const user = await getSessionUser();
  if (!user) return null;

  const enrolments = await db.enrollment.findMany({
    where: { userId: user.id, organizationId: tenant.organizationId, status: { notIn: ['CANCELLED', 'ARCHIVED', 'EXPIRED'] }, product: { course: { isNot: null } } },
    select: { productId: true, product: { select: { title: true, course: { select: { id: true } } } } },
  });
  const courseIds = enrolments.map((e) => e.product.course!.id);

  const cards = courseIds.length
    ? await db.flashcard.findMany({
        where: { organizationId: tenant.organizationId, courseId: { in: courseIds }, OR: [{ ownerUserId: null }, { ownerUserId: user.id }] },
        select: { courseId: true, reviews: { where: { userId: user.id }, select: { due: true, intervalDays: true } } },
      })
    : [];

  const now = new Date();
  const rows = enrolments
    .map((e) => {
      const mine = cards.filter((c) => c.courseId === e.product.course!.id).map((c) => ({ due: c.reviews[0]?.due ?? null, intervalDays: c.reviews[0]?.intervalDays ?? 0 }));
      return { productId: e.productId, title: e.product.title, ...standing(mine, now) };
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => b.due + b.fresh - (a.due + a.fresh));

  return (
    <div className="mx-auto max-w-3xl px-5 py-7">
      <h1 className="text-xl font-semibold">Revise</h1>
      <p className="t-small faint mt-1">A few minutes a day with the cards that are due beats an evening before the exam.</p>

      <div className="mt-6">
        {rows.length === 0 ? (
          <EmptyState title="No cards yet" hint="Cards appear here when a trainer sets them for a course you are on, or when you make your own from a course's Revise page." />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {rows.map((r) => (
              <li key={r.productId}>
                <Link href={`/learn/${r.productId}/revise`} className="block h-full">
                  <Card className="h-full hover:border-[var(--brand)]">
                    <p className="font-semibold">{r.title}</p>
                    <p className="mt-2 text-2xl font-bold tabular-nums" style={{ color: r.due + r.fresh > 0 ? 'var(--brand)' : 'var(--ink-3)' }}>
                      {r.due + r.fresh}
                    </p>
                    <p className="t-small faint">
                      to do now · {r.due} due, {r.fresh} new · {r.known} of {r.total} as good as known
                    </p>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
