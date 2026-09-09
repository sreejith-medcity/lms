import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { Badge, Card, EmptyState } from '@/components/ui';
import { QuestionForm, DeleteQuestion } from './editors';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

const TYPE_LABELS: Record<string, string> = {
  MCQ_SINGLE: 'Single answer',
  MCQ_MULTI: 'Multiple answers',
  TRUE_FALSE: 'True or false',
  SHORT_ANSWER: 'Short written',
  LONG_ANSWER: 'Long written',
};

export default async function BankPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await requireTenant();
  await requireStaff('question_bank.manage_questions', 'view');

  const bank = await db.questionBank.findFirst({
    where: { id, organizationId: tenant.organizationId },
    select: {
      id: true,
      name: true,
      exam: true,
      subject: true,
      questions: {
        orderBy: { id: 'desc' },
        select: {
          id: true,
          type: true,
          promptHtml: true,
          difficulty: true,
          marks: true,
          negativeMarks: true,
          tags: true,
          options: { orderBy: { sortOrder: 'asc' }, select: { id: true, label: true, isCorrect: true } },
          _count: { select: { answers: true, items: true } },
        },
      },
    },
  });
  if (!bank) notFound();

  return (
    <div>
      <div className="mb-6">
        <Link href="/admin/question-bank" className="t-small faint hover:underline">
          Question bank
        </Link>
        <h1 className="t-title mt-1">{bank.name}</h1>
        <p className="t-small faint mt-1">
          {[bank.exam, bank.subject].filter(Boolean).join(' · ')}
          {bank.exam || bank.subject ? ' · ' : ''}
          {bank.questions.length} question{bank.questions.length === 1 ? '' : 's'}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-3">
          {bank.questions.length === 0 ? (
            <EmptyState title="Nothing in this bank yet" hint="Write the first question beside." />
          ) : (
            bank.questions.map((q) => (
              <Card key={q.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone="brand">{TYPE_LABELS[q.type] ?? q.type}</Badge>
                      <Badge tone="neutral">{q.difficulty.toLowerCase()}</Badge>
                      <span className="t-small faint tabular-nums">
                        {q.marks} mark{q.marks === 1 ? '' : 's'}
                        {q.negativeMarks > 0 ? `, −${q.negativeMarks} wrong` : ''}
                      </span>
                      {q._count.items > 0 && (
                        <Badge tone="ok">in {q._count.items} assessment{q._count.items === 1 ? '' : 's'}</Badge>
                      )}
                    </div>

                    <p className="mt-2 text-sm">{q.promptHtml}</p>

                    {q.options.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {q.options.map((o) => (
                          <li key={o.id} className="t-small flex items-center gap-2">
                            <span
                              aria-hidden
                              className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border text-[9px] ${
                                o.isCorrect ? 'border-transparent text-white' : 'text-transparent'
                              }`}
                              style={o.isCorrect ? { background: 'var(--ok)' } : undefined}
                            >
                              ✓
                            </span>
                            <span className={o.isCorrect ? 'font-medium' : 'muted'}>{o.label}</span>
                          </li>
                        ))}
                      </ul>
                    )}

                    {q.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {q.tags.map((t) => (
                          <span key={t} className="t-micro faint rounded-full border px-2 py-0.5">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <DeleteQuestion id={q.id} answered={q._count.answers} />
                </div>
              </Card>
            ))
          )}
        </div>

        <div>
          <Card className="sticky top-6">
            <h2 className="t-heading">Add a question</h2>
            <div className="mt-5">
              <QuestionForm bankId={bank.id} />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
