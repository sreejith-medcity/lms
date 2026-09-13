import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { buildQueue, standing } from '@/lib/revision';
import { AddCardForm, ReviseSession, type SessionCard } from './session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Revise' };

/**
 * Revision for one course: the cards due today and a few new ones, then
 * the standing (known, due, new) and a way to add cards of your own.
 */
export default async function RevisePage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const tenant = await requireTenant();
  const user = await getSessionUser();
  if (!user) return null;

  const enrollment = await db.enrollment.findFirst({
    where: { userId: user.id, productId, organizationId: tenant.organizationId, status: { notIn: ['CANCELLED', 'ARCHIVED', 'EXPIRED'] } },
    select: { product: { select: { title: true, course: { select: { id: true } } } } },
  });
  if (!enrollment?.product.course) notFound();
  const courseId = enrollment.product.course.id;

  const cards = await db.flashcard.findMany({
    where: { organizationId: tenant.organizationId, courseId, OR: [{ ownerUserId: null }, { ownerUserId: user.id }] },
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      front: true,
      back: true,
      hint: true,
      ownerUserId: true,
      reviews: { where: { userId: user.id }, select: { due: true, intervalDays: true, reps: true } },
    },
  });

  const now = new Date();
  const withState = cards.map((c) => ({
    id: c.id,
    front: c.front,
    back: c.back,
    hint: c.hint,
    mine: c.ownerUserId === user.id,
    due: c.reviews[0]?.due ?? null,
    intervalDays: c.reviews[0]?.intervalDays ?? 0,
    reps: c.reviews[0]?.reps ?? 0,
  }));
  const queue: SessionCard[] = buildQueue(withState, now).map((c) => ({ id: c.id, front: c.front, back: c.back, hint: c.hint, mine: c.mine, fresh: !c.due }));
  const stand = standing(withState, now);

  return (
    <div className="mx-auto max-w-2xl px-5 py-7">
      <Link href={`/learn/${productId}`} className="t-small faint hover:underline">
        {enrollment.product.title}
      </Link>
      <h1 className="mt-1 text-xl font-semibold">Revise</h1>
      <p className="t-small faint mt-1">
        {stand.total === 0
          ? 'No cards on this course yet.'
          : `${stand.total} cards · ${stand.due} due · ${stand.fresh} new · ${stand.known} as good as known`}
      </p>

      <div className="mt-6">
        {stand.total === 0 ? (
          <div className="rounded-[var(--radius)] border bg-[var(--surface)] p-6 text-center">
            <p className="t-heading">Nothing to revise yet</p>
            <p className="t-small muted mt-1">Your trainer has not set cards for this course. You can make your own below.</p>
          </div>
        ) : (
          <ReviseSession key={queue.map((c) => c.id).join(',')} cards={queue} courseId={courseId} />
        )}
      </div>

      <div className="mt-6">
        <AddCardForm courseId={courseId} />
      </div>
    </div>
  );
}
