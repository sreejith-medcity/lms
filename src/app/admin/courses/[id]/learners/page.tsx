import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { Badge, Card, Cell, EmptyState, Row, Table } from '@/components/ui';
import { Stat, StatGrid } from '@/components/stat';
import { Meter } from '@/components/chart';

export const dynamic = 'force-dynamic';

/**
 * Everyone on this course, grouped by batch, with the two numbers that actually
 * predict whether they finish: how much of the curriculum they have covered and
 * how many of their classes they turned up to. Sorted so the ones in trouble are
 * at the top of each batch rather than buried alphabetically.
 */
export default async function CourseLearnersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await requireTenant();
  await requireStaff('batches.batch_learners', 'view');

  const product = await db.product.findFirst({
    where: { id, organizationId: tenant.organizationId, type: 'COURSE' },
    select: { id: true, course: { select: { id: true } } },
  });
  if (!product?.course) notFound();

  const [batches, enrolments] = await Promise.all([
    db.batch.findMany({
      where: { courseId: product.course.id, deletedAt: null },
      orderBy: [{ status: 'asc' }, { startDate: 'desc' }],
      select: {
        id: true,
        name: true,
        status: true,
        startDate: true,
        sessions: {
          where: { status: { not: 'CANCELLED' }, startsAt: { lte: new Date() } },
          select: { id: true },
        },
      },
    }),
    db.enrollment.findMany({
      where: { productId: product.id, status: { notIn: ['ARCHIVED'] } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        batchId: true,
        status: true,
        progressPercent: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true, phone: true } },
      },
    }),
  ]);

  const heldByBatch = new Map(batches.map((b) => [b.id, b.sessions.length]));

  const attendances = await db.attendance.groupBy({
    by: ['userId'],
    where: {
      status: { in: ['PRESENT', 'LATE'] },
      session: { batchId: { in: batches.map((b) => b.id) } },
    },
    _count: { _all: true },
  });
  const attendedBy = new Map(attendances.map((a) => [a.userId, a._count._all]));

  const unbatched = enrolments.filter((e) => !e.batchId);

  return (
    <div className="space-y-6">
      <StatGrid>
        <Stat label="Enrolled" value={String(enrolments.length)} />
        <Stat
          label="Average progress"
          value={
            enrolments.length
              ? `${Math.round(enrolments.reduce((n, e) => n + e.progressPercent, 0) / enrolments.length)}%`
              : '—'
          }
        />
        <Stat
          label="Finished"
          value={String(enrolments.filter((e) => e.status === 'COMPLETED').length)}
        />
        <Stat label="Batches" value={String(batches.length)} />
      </StatGrid>

      {enrolments.length === 0 ? (
        <EmptyState
          title="Nobody enrolled yet"
          hint="They appear here as soon as somebody buys or is enrolled by hand."
        />
      ) : (
        [...batches, null].map((batch) => {
          const rows = batch
            ? enrolments.filter((e) => e.batchId === batch.id)
            : unbatched;
          if (rows.length === 0) return null;

          const held = batch ? (heldByBatch.get(batch.id) ?? 0) : 0;

          const sorted = [...rows].sort((a, b) => {
            const aRate = held ? (attendedBy.get(a.user.id) ?? 0) / held : 1;
            const bRate = held ? (attendedBy.get(b.user.id) ?? 0) / held : 1;
            return aRate + a.progressPercent / 100 - (bRate + b.progressPercent / 100);
          });

          return (
            <section key={batch?.id ?? 'none'}>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h2 className="t-heading">{batch?.name ?? 'No batch'}</h2>
                {batch && (
                  <Badge tone={batch.status === 'ACTIVE' ? 'ok' : 'neutral'}>
                    {batch.status.toLowerCase()}
                  </Badge>
                )}
                <span className="t-small faint tabular-nums">
                  {rows.length} learner{rows.length === 1 ? '' : 's'}
                  {batch ? ` · ${held} class${held === 1 ? '' : 'es'} held` : ''}
                </span>
                {batch && (
                  <Link href={`/admin/batches/${batch.id}`} className="t-small underline">
                    Open the batch
                  </Link>
                )}
              </div>

              <Table head={['Learner', 'Enrolled', 'Progress', 'Attendance', 'Status']}>
                {sorted.map((e) => {
                  const came = attendedBy.get(e.user.id) ?? 0;
                  const rate = held > 0 ? Math.round((came / held) * 100) : null;

                  return (
                    <Row key={e.id}>
                      <Cell>
                        <Link
                          href={`/admin/learners/${e.user.id}`}
                          className="font-medium hover:underline"
                        >
                          {e.user.name}
                        </Link>
                        <span className="t-small faint block">
                          {e.user.email ?? e.user.phone ?? '—'}
                        </span>
                      </Cell>
                      <Cell className="t-small faint">
                        {e.createdAt.toLocaleDateString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </Cell>
                      <Cell>
                        <div className="w-28">
                          <span className="t-small tabular-nums">
                            {Math.round(e.progressPercent)}%
                          </span>
                          <div className="mt-1">
                            <Meter
                              value={e.progressPercent}
                              max={100}
                              tone={e.progressPercent >= 60 ? 'ok' : e.progressPercent >= 25 ? 'warn' : 'bad'}
                            />
                          </div>
                        </div>
                      </Cell>
                      <Cell>
                        {rate == null ? (
                          <span className="faint t-small">no classes yet</span>
                        ) : (
                          <div className="w-28">
                            <span className="t-small tabular-nums">
                              {rate}% <span className="faint">({came}/{held})</span>
                            </span>
                            <div className="mt-1">
                              <Meter
                                value={rate}
                                max={100}
                                tone={rate >= 75 ? 'ok' : rate >= 50 ? 'warn' : 'bad'}
                              />
                            </div>
                          </div>
                        )}
                      </Cell>
                      <Cell>
                        <Badge
                          tone={
                            e.status === 'COMPLETED'
                              ? 'ok'
                              : e.status === 'ENROLLED'
                                ? 'neutral'
                                : 'warn'
                          }
                        >
                          {e.status.toLowerCase().replace('_', ' ')}
                        </Badge>
                      </Cell>
                    </Row>
                  );
                })}
              </Table>
            </section>
          );
        })
      )}
    </div>
  );
}
