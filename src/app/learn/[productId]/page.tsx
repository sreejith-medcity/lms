import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { MATERIAL_LABELS, formatDuration, percent } from '@/lib/progress';
import { curriculumGate } from '@/lib/curriculum-access';
import { TestimonialForm } from './testimonial-form';
import { canReview } from '@/lib/reviews';
import { settingNumber } from '@/lib/settings/store';
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
                        where: { isVisible: true },
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

  // Asked once they are far enough in to have an opinion worth reading; the
  // academy sets how far. Anyone who already wrote one keeps seeing it.
  const [reviewAfter, nextOnPath, transcriptCount] = await Promise.all([
    settingNumber(tenant.organizationId, 'learning.reviewAfterPercent'),
    // Where the path goes from here: the courses that list this one as a
    // prerequisite, shown once this one is done.
    enrollment.progressPercent >= 100
      ? db.coursePrerequisite.findMany({
          where: {
            organizationId: tenant.organizationId,
            requiredCourseId: enrollment.product.course.id,
            course: { product: { status: 'PUBLISHED', deletedAt: null, isAddonOnly: false } },
          },
          select: { course: { select: { product: { select: { id: true, title: true, slug: true } } } } },
        })
      : Promise.resolve([]),
    // Whether there is anything to search: a lesson with a transcript.
    db.transcript.count({
      where: { asset: { organizationId: tenant.organizationId, materials: { some: { section: { module: { courses: { some: { courseId: enrollment.product.course.id } } } } } } } },
    }),
  ]);
  const hasTranscripts = transcriptCount > 0;
  const finished = canReview(enrollment.progressPercent, reviewAfter);
  const myTestimonial = finished
    ? await db.testimonial.findFirst({
        where: { organizationId: tenant.organizationId, userId: user.id, productId },
        select: { rating: true, comment: true, isPublished: true, reply: true },
      })
    : null;

  const gate = await curriculumGate({
    courseId: enrollment.product.course.id,
    enrolledAt: enrollment.createdAt,
    batchId: enrollment.batchId,
  });

  const modules = enrollment.product.course.modules.filter((cm) => gate.teaches(cm.moduleId));

  const materials = modules.flatMap((cm) => cm.module.sections.flatMap((s) => s.materials));
  const completed = materials.filter((m) => doneSet.has(m.id)).length;

  // "Continue" should never land on a locked lesson.
  const next = modules
    .flatMap((cm) => cm.module.sections.flatMap((s) => s.materials.map((m) => ({ m, s }))))
    .find(({ m, s }) => !doneSet.has(m.id) && !gate.lockOf(m.id, s.id))?.m;

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

        <div className="flex items-center gap-3">
        {hasTranscripts && (
          <Link
            href={`/learn/${productId}/search`}
            className="rounded-[var(--radius-sm)] border px-4 py-2 text-sm hover:bg-[var(--surface-2)]"
          >
            Search
          </Link>
        )}
        <Link
          href={`/learn/${productId}/discussion`}
          className="rounded-[var(--radius-sm)] border px-4 py-2 text-sm hover:bg-[var(--surface-2)]"
        >
          Discussion
        </Link>
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
      </div>

      {materials.length === 0 && recordings.length === 0 && assessments.length === 0 && (
        <EmptyState title="No content yet" hint="Your academy is still preparing this course." />
      )}

      {nextOnPath.length > 0 && (
        <Card>
          <h2 className="t-heading">Next on your path</h2>
          <p className="t-small muted mt-1">You have finished this course, which unlocks:</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {nextOnPath.map((n) => (
              <li key={n.course.product.id}>
                <Link
                  href={`/course/${n.course.product.slug}`}
                  className="inline-flex h-9 items-center rounded-[var(--radius-sm)] px-3.5 text-sm font-semibold text-[var(--brand-ink)]"
                  style={{ background: 'var(--brand)' }}
                >
                  {n.course.product.title} →
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {finished && (
        <TestimonialForm
          productId={productId}
          courseTitle={enrollment.product.title}
          progressPercent={enrollment.progressPercent}
          existing={
            myTestimonial
              ? {
                  rating: myTestimonial.rating,
                  comment: myTestimonial.comment ?? '',
                  isPublished: myTestimonial.isPublished,
                  reply: myTestimonial.reply,
                }
              : null
          }
        />
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

      {modules.map((cm) => (
        <Card key={cm.moduleId} className="space-y-4">
          <h2 className="font-medium">{cm.module.name}</h2>

          {cm.module.sections.map((section) => (
            <div key={section.id}>
              <p className="mb-1 text-sm font-medium muted">{section.title}</p>
              <ul className="divide-y rounded-[var(--radius-sm)] border">
                {section.materials.map((m) => {
                  const isDone = doneSet.has(m.id);
                  const lock = gate.lockOf(m.id, section.id);

                  const inner = (
                    <>
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
                        <span className={`truncate text-sm ${lock ? 'faint' : ''}`}>{m.title}</span>
                      </span>
                      <span className="shrink-0 t-small faint">
                        {lock ? (
                          <span className="inline-flex items-center gap-1">
                            <span aria-hidden>🔒</span>
                            {lock.label}
                          </span>
                        ) : (
                          <>
                            {MATERIAL_LABELS[m.type] ?? m.type}
                            {m.durationSeconds ? ` · ${formatDuration(m.durationSeconds)}` : ''}
                          </>
                        )}
                      </span>
                    </>
                  );

                  return (
                    <li key={m.id}>
                      {lock ? (
                        <div
                          className="flex cursor-not-allowed items-center justify-between gap-3 px-4 py-2.5"
                          title={`Opens ${lock.until.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}`}
                        >
                          {inner}
                        </div>
                      ) : (
                        <Link
                          href={`/learn/${productId}/${m.id}`}
                          className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-[var(--surface-2)]"
                        >
                          {inner}
                        </Link>
                      )}
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
