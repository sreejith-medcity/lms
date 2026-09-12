import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { formatDateTime, toLocalInput } from '@/lib/clock';
import { formatBytes } from '@/lib/storage';
import { dueLabel, handInTally, latestOf, trimNumber } from '@/lib/assignment-rules';
import { Avatar } from '@/components/avatar';
import { Badge, Card, Cell, EmptyState, PageHeader, Row, Section, Table } from '@/components/ui';
import { AssignmentEditor, BriefFiles } from './editor';
import { courseOptions } from '../options';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * One piece of homework: the brief on the left, the class on the right.
 *
 * The class list shows every learner it was set for, not only the ones who
 * handed in, because "who has not" is the question a trainer asks on the
 * morning after the due date and a list of submissions cannot answer it.
 */
export default async function AssignmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await requireTenant();
  const me = await requireStaff('courses.assessments', 'view');
  const canEdit = me.permissions['courses.assessments']?.edit ?? false;
  const canDelete = me.permissions['courses.assessments']?.delete ?? false;
  const canMark = me.permissions['submission.evaluate_submissions']?.edit ?? false;
  const tz = tenant.timezone;

  const a = await db.assignment.findFirst({
    where: { id, organizationId: tenant.organizationId, deletedAt: null },
    select: {
      id: true,
      courseId: true,
      batchId: true,
      title: true,
      instructions: true,
      maxMarks: true,
      dueAt: true,
      acceptLate: true,
      allowResubmit: true,
      requireText: true,
      requireFile: true,
      status: true,
      publishedAt: true,
      course: { select: { productId: true, product: { select: { title: true } } } },
      batch: { select: { name: true } },
      attachments: { orderBy: { sortOrder: 'asc' }, select: { assetId: true, asset: { select: { fileName: true, sizeBytes: true } } } },
      submissions: {
        orderBy: [{ submittedAt: 'desc' }],
        select: { id: true, userId: true, attemptNo: true, status: true, submittedAt: true, isLate: true, marks: true, _count: { select: { files: true } } },
      },
    },
  });
  if (!a) notFound();

  const [courses, classList] = await Promise.all([
    courseOptions(db, tenant.organizationId),
    db.enrollment.findMany({
      where: {
        organizationId: tenant.organizationId,
        status: { in: ['ENROLLED', 'ON_LEAVE', 'COMPLETED'] },
        product: { id: a.course.productId },
        ...(a.batchId ? { batchId: a.batchId } : {}),
      },
      distinct: ['userId'],
      select: { userId: true, user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
      orderBy: { user: { name: 'asc' } },
    }),
  ]);

  const byUser = new Map<string, typeof a.submissions>();
  for (const s of a.submissions) byUser.set(s.userId, [...(byUser.get(s.userId) ?? []), s]);
  // Somebody who handed in and then left the batch still appears: their work exists.
  const people = [...classList.map((e) => e.user)];
  for (const s of a.submissions) {
    if (!people.some((p) => p.id === s.userId)) {
      const u = await db.user.findFirst({ where: { id: s.userId, organizationId: tenant.organizationId }, select: { id: true, name: true, email: true, avatarUrl: true } });
      if (u) people.push(u);
    }
  }
  const tally = handInTally(a.submissions, classList.length);

  const order = (userId: string) => {
    const latest = latestOf(byUser.get(userId) ?? []);
    if (!latest) return 3;
    if (latest.status === 'SUBMITTED') return 0;
    if (latest.status === 'RETURNED') return 1;
    return 2;
  };
  people.sort((x, y) => order(x.id) - order(y.id) || x.name.localeCompare(y.name));

  return (
    <div className="space-y-6">
      <PageHeader
        title={a.title}
        description={`${a.course.product.title}${a.batch ? ` · ${a.batch.name}` : ' · every batch'}${a.dueAt ? ` · due ${formatDateTime(a.dueAt, tz)} (${dueLabel(a.dueAt)})` : ' · no due date'}`}
        action={
          <Link href="/admin/assignments" className="t-small faint hover:underline">
            All assignments
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <div className="min-w-0 space-y-6">
          <Card>
            <AssignmentEditor
              courses={courses}
              canDelete={canDelete}
              draft={{
                id: a.id,
                courseId: a.courseId,
                batchId: a.batchId,
                title: a.title,
                instructions: a.instructions ?? '',
                maxMarks: a.maxMarks,
                dueAtLocal: toLocalInput(a.dueAt, tz),
                acceptLate: a.acceptLate,
                allowResubmit: a.allowResubmit,
                requireText: a.requireText,
                requireFile: a.requireFile,
                status: a.status,
                hasHandIns: a.submissions.length > 0,
              }}
            />
          </Card>
          <Section title="Files with the brief">
            <BriefFiles
              assignmentId={a.id}
              canEdit={canEdit}
              files={a.attachments.map((f) => ({ assetId: f.assetId, name: f.asset.fileName, size: formatBytes(f.asset.sizeBytes) }))}
            />
          </Section>
        </div>

        <div className="min-w-0 space-y-4">
          <div className="grid grid-cols-4 gap-2">
            <Stat label="In class" value={classList.length} />
            <Stat label="Handed in" value={tally.handedIn} />
            <Stat label="To mark" value={tally.toMark} tone={tally.toMark ? 'warn' : undefined} />
            <Stat label="Missing" value={tally.missing} tone={tally.missing && a.dueAt && a.dueAt < new Date() ? 'bad' : undefined} />
          </div>

          {people.length === 0 ? (
            <EmptyState title="Nobody in the class yet" hint={a.batchId ? 'Enrol learners into the batch and they will see this.' : 'Enrol learners into the course and they will see this.'} />
          ) : (
            <Table head={['Learner', 'Hand-in', 'Mark']}>
              {people.map((p) => {
                const own = byUser.get(p.id) ?? [];
                const latest = latestOf(own);
                return (
                  <Row key={p.id}>
                    <Cell>
                      <span className="flex items-center gap-2">
                        <Avatar name={p.name} src={p.avatarUrl} size={28} />
                        <span className="min-w-0">
                          <Link href={`/admin/learners/${p.id}`} className="t-small block truncate font-medium hover:underline">
                            {p.name}
                          </Link>
                          <span className="t-micro faint block truncate">{p.email}</span>
                        </span>
                      </span>
                    </Cell>
                    <Cell className="t-small">
                      {latest ? (
                        <Link href={`/admin/assignments/${a.id}/hand-ins/${latest.id}`} className="hover:underline">
                          <span className="block">
                            {formatDateTime(latest.submittedAt, tz)}
                            {latest.isLate && (
                              <>
                                {' '}
                                <Badge tone="warn">late</Badge>
                              </>
                            )}
                          </span>
                          <span className="t-micro faint">
                            {own.length > 1 ? `attempt ${latest.attemptNo} of ${own.length}` : ''}
                            {latest._count.files ? `${own.length > 1 ? ' · ' : ''}${latest._count.files} file${latest._count.files === 1 ? '' : 's'}` : ''}
                          </span>
                        </Link>
                      ) : (
                        <span className="faint">not yet</span>
                      )}
                    </Cell>
                    <Cell className="t-small">
                      {!latest ? (
                        <span className="faint">–</span>
                      ) : latest.status === 'SUBMITTED' ? (
                        canMark ? (
                          <Link href={`/admin/assignments/${a.id}/hand-ins/${latest.id}`} className="font-medium text-[var(--warn)] hover:underline">
                            Mark it
                          </Link>
                        ) : (
                          <Badge tone="warn">to mark</Badge>
                        )
                      ) : latest.status === 'RETURNED' ? (
                        <Badge tone="neutral">returned</Badge>
                      ) : (
                        <span className="tabular-nums">
                          {trimNumber(latest.marks ?? 0)} / {trimNumber(a.maxMarks)}
                        </span>
                      )}
                    </Cell>
                  </Row>
                );
              })}
            </Table>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'warn' | 'bad' }) {
  const color = tone === 'warn' ? 'text-[var(--warn)]' : tone === 'bad' ? 'text-[var(--bad)]' : '';
  return (
    <div className="rounded-[var(--radius-sm)] border bg-[var(--surface)] px-3 py-2">
      <p className={`text-lg font-semibold tabular-nums ${color}`}>{value}</p>
      <p className="t-micro faint">{label}</p>
    </div>
  );
}
