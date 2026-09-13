import Link from 'next/link';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { getSessionUser } from '@/lib/auth';
import { formatDateTime } from '@/lib/clock';
import { askingCount, queueOrder, waitingLabel } from '@/lib/lesson-qa';
import { Badge, EmptyState, PageHeader } from '@/components/ui';
import { AnswerForm } from './answer-form';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

function stamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Every question asked on a lesson, unanswered first, the ones most learners
 * are waiting on at the top. A trainer answers here without opening the
 * lesson; the answer appears under it and the learners waiting are told.
 */
export default async function QuestionsQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string; course?: string }>;
}) {
  const tenant = await requireTenant();
  const me = await getSessionUser();
  if (!me || me.kind !== 'STAFF') throw new Error('UNAUTHORIZED');
  const canView =
    me.permissions['discussions.moderate_discussions']?.view ||
    me.permissions['courses.course_management']?.view;
  if (!canView) throw new Error('FORBIDDEN');
  const canEdit = Boolean(
    me.permissions['discussions.moderate_discussions']?.edit ||
      me.permissions['courses.course_management']?.edit,
  );

  const { show = 'waiting', course } = await searchParams;

  const rows = await db.lessonQuestion.findMany({
    where: {
      organizationId: tenant.organizationId,
      ...(course ? { courseId: course } : {}),
      ...(show === 'waiting' ? { answeredAt: null, isHidden: false } : {}),
      ...(show === 'answered' ? { answeredAt: { not: null } } : {}),
      ...(show === 'hidden' ? { isHidden: true } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 300,
    select: {
      id: true,
      userId: true,
      batchId: true,
      courseId: true,
      body: true,
      atSeconds: true,
      answer: true,
      answeredById: true,
      answeredAt: true,
      alsoAsking: true,
      isPinned: true,
      isHidden: true,
      createdAt: true,
      user: { select: { name: true } },
      material: { select: { id: true, title: true, type: true } },
    },
  });

  const courseIds = Array.from(new Set(rows.map((r) => r.courseId)));
  const batchIds = Array.from(new Set(rows.map((r) => r.batchId).filter((b): b is string => Boolean(b))));
  const staffIds = Array.from(new Set(rows.map((r) => r.answeredById).filter((s): s is string => Boolean(s))));

  const [courses, batches, staff, allCourses, waitingCount] = await Promise.all([
    db.course.findMany({
      where: { id: { in: courseIds }, organizationId: tenant.organizationId },
      select: { id: true, productId: true, product: { select: { title: true } } },
    }),
    batchIds.length
      ? db.batch.findMany({ where: { id: { in: batchIds }, organizationId: tenant.organizationId }, select: { id: true, name: true } })
      : Promise.resolve([]),
    staffIds.length
      ? db.user.findMany({ where: { id: { in: staffIds }, organizationId: tenant.organizationId }, select: { id: true, name: true } })
      : Promise.resolve([]),
    db.lessonQuestion
      .findMany({
        where: { organizationId: tenant.organizationId },
        distinct: ['courseId'],
        select: { courseId: true },
      })
      .then((asked) =>
        asked.length
          ? db.course.findMany({
              where: { id: { in: asked.map((a) => a.courseId) }, organizationId: tenant.organizationId },
              select: { id: true, product: { select: { title: true } } },
              orderBy: { product: { title: 'asc' } },
            })
          : [],
      ),
    db.lessonQuestion.count({ where: { organizationId: tenant.organizationId, answeredAt: null, isHidden: false } }),
  ]);

  const courseById = new Map(courses.map((c) => [c.id, c]));
  const batchById = new Map(batches.map((b) => [b.id, b.name]));
  const staffById = new Map(staff.map((s) => [s.id, s.name]));

  const ordered = queueOrder(rows);

  const filters: { key: string; label: string }[] = [
    { key: 'waiting', label: 'Waiting' },
    { key: 'answered', label: 'Answered' },
    { key: 'all', label: 'Everything' },
    { key: 'hidden', label: 'Hidden' },
  ];
  const href = (next: { show?: string; course?: string }) => {
    const p = new URLSearchParams();
    const s = next.show ?? show;
    const c = next.course === undefined ? course : next.course;
    if (s && s !== 'waiting') p.set('show', s);
    if (c) p.set('course', c);
    const qs = p.toString();
    return qs ? `/admin/questions?${qs}` : '/admin/questions';
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Questions on lessons"
        description={`${waitingLabel(waitingCount)}. A learner asked from a lesson; the answer goes back under it and everyone with the same question is told.`}
      />

      <div className="flex flex-wrap items-center gap-2">
        {filters.map((f) => (
          <Link
            key={f.key}
            href={href({ show: f.key })}
            className="t-small rounded-full border px-3 py-1 font-semibold"
            style={show === f.key ? { background: 'var(--brand)', color: 'var(--brand-ink)', borderColor: 'var(--brand)' } : undefined}
          >
            {f.label}
          </Link>
        ))}
        {allCourses.length > 1 && (
          <span className="ml-auto flex flex-wrap items-center gap-2">
            <Link href={href({ course: '' })} className="t-small underline" style={!course ? { fontWeight: 600 } : undefined}>
              All courses
            </Link>
            {allCourses.map((c) => (
              <Link key={c.id} href={href({ course: c.id })} className="t-small underline" style={course === c.id ? { fontWeight: 600 } : undefined}>
                {c.product.title}
              </Link>
            ))}
          </span>
        )}
      </div>

      {ordered.length === 0 ? (
        <EmptyState
          title={show === 'waiting' ? 'Nothing waiting' : 'No questions here'}
          hint="Learners ask from the Q&A tab beside a lesson. Questions land here the moment they are asked."
        />
      ) : (
        <ul className="space-y-3">
          {ordered.map((q) => {
            const c = courseById.get(q.courseId);
            const lessonHref = c ? `/learn/${c.productId}/${q.material.id}?tab=qa` : null;
            return (
              <li key={q.id} className="rounded-[var(--radius)] border bg-[var(--surface)] p-4">
                <div className="flex flex-wrap items-center gap-2">
                  {!q.answeredAt && !q.isHidden && <Badge tone="warn">Waiting</Badge>}
                  {q.answeredAt && <Badge tone="ok">Answered</Badge>}
                  {q.isPinned && <Badge tone="brand">Pinned</Badge>}
                  {q.isHidden && <Badge tone="bad">Hidden</Badge>}
                  <span className="t-small muted">
                    {c?.product.title ?? 'Course'}
                    {q.batchId ? ` · ${batchById.get(q.batchId) ?? 'batch'}` : ' · self-paced'}
                  </span>
                  <span className="t-small faint ml-auto">{formatDateTime(q.createdAt, tenant.timezone)}</span>
                </div>

                <p className="mt-2 text-sm">
                  <span className="font-semibold">{q.user.name}</span>
                  <span className="faint"> on </span>
                  {lessonHref ? (
                    <Link href={lessonHref} className="font-semibold underline" style={{ color: 'var(--brand)' }}>
                      {q.material.title}
                    </Link>
                  ) : (
                    <span className="font-semibold">{q.material.title}</span>
                  )}
                  {q.atSeconds != null && <span className="faint"> at {stamp(q.atSeconds)}</span>}
                  {askingCount(q) > 1 && (
                    <span className="faint"> · {askingCount(q)} people asking</span>
                  )}
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm">{q.body}</p>

                {q.answer && (
                  <div className="mt-3 rounded-[var(--radius-sm)] border-l-4 bg-[var(--surface-2)] p-3" style={{ borderColor: 'var(--brand)' }}>
                    <p className="t-small font-semibold">
                      {q.answeredById ? (staffById.get(q.answeredById) ?? 'Trainer') : 'Trainer'}
                      {q.answeredAt && <span className="faint font-normal"> · {formatDateTime(q.answeredAt, tenant.timezone)}</span>}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm">{q.answer}</p>
                  </div>
                )}

                <AnswerForm questionId={q.id} answer={q.answer} isPinned={q.isPinned} isHidden={q.isHidden} canEdit={canEdit} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
