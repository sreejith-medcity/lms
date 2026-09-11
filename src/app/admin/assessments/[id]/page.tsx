import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { parseBlueprint } from '@/lib/paper-blueprint';
import { Badge, Card } from '@/components/ui';
import { SettingsForm, QuestionPicker, CoursePicker, PaperList, RedrawButton } from './editors';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function AssessmentDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await requireTenant();
  await requireStaff('courses.assessments', 'view');

  const assessment = await db.assessment.findFirst({
    where: { id, organizationId: tenant.organizationId },
    select: {
      id: true,
      title: true,
      kind: true,
      instructions: true,
      durationMinutes: true,
      maxAttempts: true,
      passPercent: true,
      shuffleQuestions: true,
      showResultsImmediately: true,
      blueprint: true,
      courses: { select: { courseId: true } },
      questions: {
        orderBy: { sortOrder: 'asc' },
        select: {
          marks: true,
          question: {
            select: {
              id: true,
              type: true,
              promptHtml: true,
              marks: true,
              negativeMarks: true,
              bank: { select: { name: true } },
            },
          },
        },
      },
      _count: { select: { attempts: true } },
    },
  });
  if (!assessment) notFound();

  const recipe = parseBlueprint(((assessment.blueprint ?? {}) as { sections?: unknown }).sections);

  const [banks, courses] = await Promise.all([
    db.questionBank.findMany({
      where: { organizationId: tenant.organizationId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, _count: { select: { questions: true } } },
    }),
    db.course.findMany({
      where: { organizationId: tenant.organizationId },
      select: { id: true, product: { select: { title: true } } },
    }),
  ]);

  const chosen = new Set(assessment.questions.map((q) => q.question.id));
  const total = assessment.questions.reduce((n, q) => n + (q.marks ?? q.question.marks), 0);
  const locked = assessment._count.attempts > 0;

  return (
    <div>
      <div className="mb-6">
        <Link href="/admin/assessments" className="t-small faint hover:underline">
          Assessments
        </Link>
        <h1 className="t-title mt-1 flex flex-wrap items-center gap-2">
          {assessment.title}
          <Badge tone="neutral">{assessment.kind.toLowerCase().replace('_', ' ')}</Badge>
          {locked && <Badge tone="warn">{assessment._count.attempts} attempts taken</Badge>}
        </h1>
        <p className="t-small faint mt-1 tabular-nums">
          {assessment.questions.length} question{assessment.questions.length === 1 ? '' : 's'} ·{' '}
          {total} mark{total === 1 ? '' : 's'}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-5">
          {recipe.length > 0 && (
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="t-heading">Drawn from a recipe</h2>
                  <ul className="t-small muted mt-1.5 space-y-0.5">
                    {recipe.map((r, i) => (
                      <li key={i}>
                        {r.label}: {r.count}
                        {r.difficulty ? ` ${r.difficulty.toLowerCase()}` : ''}
                        {r.tags?.length ? ` tagged ${r.tags.join(r.anyTag ? ' or ' : ' and ')}` : ''}
                        {r.bankIds?.length ? ' from one bank' : ''}
                      </li>
                    ))}
                  </ul>
                </div>
                {!locked && <RedrawButton assessmentId={assessment.id} />}
              </div>
            </Card>
          )}

          <section>
            <h2 className="t-heading mb-3">The paper</h2>
            <PaperList
              assessmentId={assessment.id}
              locked={locked}
              items={assessment.questions.map((q) => ({
                id: q.question.id,
                type: q.question.type,
                prompt: q.question.promptHtml,
                marks: q.marks ?? q.question.marks,
                negative: q.question.negativeMarks,
                bank: q.question.bank.name,
              }))}
            />
          </section>

          <section>
            <h2 className="t-heading mb-3">Add from the bank</h2>
            <QuestionPicker
              assessmentId={assessment.id}
              banks={banks.map((b) => ({ id: b.id, name: b.name, count: b._count.questions }))}
              chosenCount={chosen.size}
              locked={locked}
            />
          </section>
        </div>

        <div className="space-y-5">
          <Card>
            <h2 className="t-heading">Settings</h2>
            <div className="mt-5">
              <SettingsForm assessment={assessment} />
            </div>
          </Card>

          <Card>
            <h2 className="t-heading">Courses</h2>
            <p className="t-small muted mt-1">
              A learner reaches this only through a course they are enrolled in. Attached to
              nothing, it is invisible to everyone.
            </p>
            <div className="mt-4">
              <CoursePicker
                assessmentId={assessment.id}
                courses={courses.map((c) => ({ id: c.id, title: c.product.title }))}
                selected={assessment.courses.map((c) => c.courseId)}
              />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
