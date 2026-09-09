import Link from 'next/link';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { NewBankForm, DeleteBank } from './editors';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function QuestionBankPage() {
  const tenant = await requireTenant();
  await requireStaff('question_bank.manage_banks', 'view');

  const banks = await db.questionBank.findMany({
    where: { organizationId: tenant.organizationId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      exam: true,
      subject: true,
      topic: true,
      _count: { select: { questions: true } },
    },
  });

  return (
    <div>
      <PageHeader
        title="Question bank"
        description="Questions live here, not inside a single test. The same OET reading question can sit in a practice set, a mock exam and a placement test, written once."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-3">
          {banks.length === 0 ? (
            <EmptyState
              title="No banks yet"
              hint="Start with one per exam and subject: OET Reading, IELTS Writing, German A1 Grammar."
            />
          ) : (
            banks.map((b) => (
              <Card key={b.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <Link
                      href={`/admin/question-bank/${b.id}`}
                      className="font-medium hover:underline"
                    >
                      {b.name}
                    </Link>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {b.exam && <Badge tone="brand">{b.exam}</Badge>}
                      {b.subject && <Badge tone="neutral">{b.subject}</Badge>}
                      {b.topic && <Badge tone="neutral">{b.topic}</Badge>}
                    </div>
                    <p className="t-small faint mt-1.5 tabular-nums">
                      {b._count.questions} question{b._count.questions === 1 ? '' : 's'}
                    </p>
                  </div>
                  {b._count.questions === 0 && <DeleteBank id={b.id} />}
                </div>
              </Card>
            ))
          )}
        </div>

        <Card>
          <h2 className="t-heading">New bank</h2>
          <p className="t-small muted mt-1">
            The exam, subject and topic are how you find a question again when the bank has
            two thousand in it.
          </p>
          <div className="mt-5">
            <NewBankForm />
          </div>
        </Card>
      </div>
    </div>
  );
}
