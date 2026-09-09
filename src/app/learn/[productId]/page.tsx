import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { MATERIAL_LABELS, formatDuration, percent } from '@/lib/progress';
import { Card, EmptyState } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function CourseOutline({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const tenant = await requireTenant();
  const user = await getSessionUser();
  if (!user) return null;

  const enrollment = await db.enrollment.findFirst({
    where: {
      userId: user.id,
      productId,
      organizationId: tenant.organizationId,
      status: { notIn: ['CANCELLED', 'ARCHIVED'] },
    },
    include: {
      product: {
        select: {
          id: true,
          title: true,
          course: {
            select: {
              id: true,
              modulesArePrerequisite: true,
              modules: {
                orderBy: { sortOrder: 'asc' },
                include: {
                  module: {
                    include: {
                      sections: {
                        orderBy: { sortOrder: 'asc' },
                        include: { materials: { orderBy: { sortOrder: 'asc' } } },
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
  if (!enrollment?.product.course) notFound();

  // Recordings of the classes this learner's batch actually sat in. Edmingle buries
  // these; here they sit on the course page next to the material that came with them.
  const recordings = enrollment.batchId
    ? await db.recording.findMany({
        where: { isPublished: true, session: { batchId: enrollment.batchId } },
        orderBy: { session: { startsAt: 'desc' } },
        take: 30,
        select: {
          id: true,
          title: true,
          assetId: true,
          session: { select: { title: true, startsAt: true } },
        },
      })
    : [];

  const assessments = await db.assessment.findMany({
    where: {
      organizationId: tenant.organizationId,
      courses: { some: { courseId: enrollment.product.course.id } },
      questions: { some: {} },
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      title: true,
      kind: true,
      durationMinutes: true,
      passPercent: true,
      _count: { select: { questions: true } },
      attempts: {
        where: { userId: user.id },
        orderBy: { attemptNo: 'desc' },
        take: 1,
        select: { status: true, scorePercent: true, passed: true },
      },
    },
  });

  const done = await db.materialProgress.findMany({
    where: { userId: user.id, completedAt: { not: null } },
    select: { materialId: true },
  });
  const doneSet = new Set(done.map((d) => d.materialId));

  const materials = enrollment.product.course.modules.flatMap((cm) =>
    cm.module.sections.flatMap((s) => s.materials),
  );
  const completed = materials.filter((m) => doneSet.has(m.id)).length;
  const next = materials.find((m) => !doneSet.has(m.id));

  return (
    <div className="mx-auto max-w-5xl px-5 py-7">
      <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/learn" className="t-small faint hover:underline">
            My learning
          </Link>
          <h1 className="mt-1 text-xl font-semibold">{enrollment.product.title}</h1>
          <p className="mt-1 t-small faint">
            {completed} of {materials.length} done · {percent(completed, materials.length)}%
          </p>
        </div>

        {next && (
          <Link
            href={`/learn/${productId}/${next.id}`}
            className="rounded-[var(--radius-sm)] px-4 py-2 text-sm font-medium text-white"
            style={{ background: 'var(--brand)' }}
          >
            {completed === 0 ? 'Start' : 'Continue'}
          </Link>
        )}
      </div>

      {materials.length === 0 && recordings.length === 0 && assessments.length === 0 && (
        <EmptyState title="No content yet" hint="Your academy is still preparing this course." />
      )}

      {assessments.length > 0 && (
        <Card className="space-y-3">
          <h2 className="font-medium">Tests and assignments</h2>
          <ul className="divide-y rounded-[var(--radius-sm)] border">
            {assessments.map((a) => {
              const last = a.attempts[0];
              return (
                <li key={a.id}>
                  <Link
                    href={`/learn/assessment/${a.id}`}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-[var(--surface-2)]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{a.title}</span>
                      <span className="t-small faint">
                        {a._count.questions} question{a._count.questions === 1 ? '' : 's'}
                        {a.durationMinutes ? ` · ${a.durationMinutes} min` : ''} · pass{' '}
                        {a.passPercent}%
                      </span>
                    </span>
                    <span className="t-small shrink-0 tabular-nums">
                      {!last && <span className="faint">Not attempted</span>}
                      {last?.status === 'IN_PROGRESS' && <span className="faint">In progress</span>}
                      {last?.status === 'SUBMITTED' && <span className="faint">Awaiting marking</span>}
                      {last?.status === 'EVALUATED' && last.scorePercent != null && (
                        <span
                          className="font-medium"
                          style={{ color: last.passed ? 'var(--ok)' : 'var(--bad)' }}
                        >
                          {last.scorePercent}%
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {recordings.length > 0 && (
        <Card className="space-y-3">
          <h2 className="font-medium">Class recordings</h2>
          <ul className="divide-y rounded-[var(--radius-sm)] border">
            {recordings.map((r) => (
              <li key={r.id}>
                <a
                  href={`/api/assets/${r.assetId}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-[var(--surface-2)]"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm">{r.title}</span>
                    <span className="t-small faint">{r.session.title}</span>
                  </span>
                  <span className="t-small faint shrink-0">
                    {r.session.startsAt.toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {enrollment.product.course.modules.map((cm) => (
        <Card key={cm.moduleId} className="space-y-4">
          <h2 className="font-medium">{cm.module.name}</h2>

          {cm.module.sections.map((section) => (
            <div key={section.id}>
              <p className="mb-1 text-sm font-medium muted">{section.title}</p>
              <ul className="divide-y rounded-[var(--radius-sm)] border">
                {section.materials.map((m) => {
                  const isDone = doneSet.has(m.id);
                  return (
                    <li key={m.id}>
                      <Link
                        href={`/learn/${productId}/${m.id}`}
                        className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-[var(--surface-2)]"
                      >
                        <span className="flex min-w-0 items-center gap-3">
                          <span
                            aria-hidden
                            className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[10px] ${
                              isDone ? 'border-transparent text-white' : 'text-transparent'
                            }`}
                            style={isDone ? { background: 'var(--brand)' } : undefined}
                          >
                            ✓
                          </span>
                          <span className="truncate text-sm">{m.title}</span>
                        </span>
                        <span className="shrink-0 t-small faint">
                          {MATERIAL_LABELS[m.type] ?? m.type}
                          {m.durationSeconds ? ` · ${formatDuration(m.durationSeconds)}` : ''}
                        </span>
                      </Link>
                    </li>
                  );
                })}
                {section.materials.length === 0 && (
                  <li className="px-4 py-2.5 t-small faint">Nothing here yet.</li>
                )}
              </ul>
            </div>
          ))}
        </Card>
      ))}
      </div>
    </div>
  );
}
