import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { anthropicReady } from '@/lib/anthropic';
import { Card, EmptyState } from '@/components/ui';
import { CardEditor, CardRow, DraftFromLesson } from './editors';

export const dynamic = 'force-dynamic';

/**
 * The course's flashcards: what learners revise. Written by hand, or
 * drafted from a lesson's transcript and read through. A learner's own
 * cards never appear here; they are theirs.
 */
export default async function FlashcardsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await requireTenant();
  const me = await requireStaff('courses.course_management', 'view');
  const canEdit = me.permissions['courses.course_management']?.edit ?? false;

  const product = await db.product.findFirst({
    where: { id, organizationId: tenant.organizationId, type: 'COURSE' },
    select: {
      id: true,
      course: {
        select: {
          id: true,
          flashcards: {
            where: { ownerUserId: null },
            orderBy: { sortOrder: 'asc' },
            select: { id: true, front: true, back: true, hint: true, source: true, materialId: true, _count: { select: { reviews: true } } },
          },
          modules: {
            select: {
              module: {
                select: {
                  sections: {
                    select: {
                      materials: {
                        where: { asset: { transcript: { isNot: null } } },
                        select: { id: true, title: true },
                        orderBy: { sortOrder: 'asc' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!product?.course) notFound();

  const lessonsWithTranscripts = product.course.modules.flatMap((cm) => cm.module.sections.flatMap((s) => s.materials));
  const aiReady = await anthropicReady(tenant.organizationId);
  const cards = product.course.flashcards;

  return (
    <div className="max-w-3xl space-y-5">
      <Card>
        <h2 className="t-heading">Cards to revise</h2>
        <p className="t-small muted mt-1 max-w-prose">
          Every learner on the course sees these on their Revise page, spaced so a card they know comes back rarely and one they
          miss comes back soon. {cards.length} card{cards.length === 1 ? '' : 's'} so far.
        </p>
        {canEdit && (
          <div className="mt-4">
            <CardEditor courseId={product.course.id} />
          </div>
        )}
      </Card>

      {canEdit && aiReady && lessonsWithTranscripts.length > 0 && (
        <Card>
          <h2 className="t-heading">Draft cards from a lesson</h2>
          <p className="t-small muted mt-1 max-w-prose">
            The model reads the lesson&rsquo;s transcript and writes cards for the terms and points in it. They land below marked
            &ldquo;model&rdquo; so you can read them first.
          </p>
          <div className="mt-4">
            <DraftFromLesson lessons={lessonsWithTranscripts} />
          </div>
        </Card>
      )}

      {cards.length === 0 ? (
        <EmptyState title="No cards yet" hint="Add one above, or draft a set from a lesson that has a transcript." />
      ) : (
        <ul className="space-y-2">
          {cards.map((c) => (
            <CardRow
              key={c.id}
              card={{ id: c.id, front: c.front, back: c.back, hint: c.hint, source: c.source, reviewed: c._count.reviews }}
              courseId={product.course!.id}
              canEdit={canEdit}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
