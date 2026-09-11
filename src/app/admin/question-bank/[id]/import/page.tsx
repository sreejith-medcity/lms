import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { Card, PageHeader } from '@/components/ui';
import { QuestionImporter } from './importer';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function ImportQuestionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await requireTenant();
  await requireStaff('question_bank.manage_questions', 'edit');

  const bank = await db.questionBank.findFirst({
    where: { id, organizationId: tenant.organizationId },
    select: { id: true, name: true, _count: { select: { questions: true } } },
  });
  if (!bank) notFound();

  return (
    <div>
      <PageHeader
        title={`Import into ${bank.name}`}
        description="Checked before anything is written. The first pass reads the file and shows every question it found and every line it could not read; only then can you import."
        action={
          <Link href={`/admin/question-bank/${bank.id}`} className="t-small underline">
            Back to the bank
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <QuestionImporter bankId={bank.id} />

        <div className="space-y-4">
          <Card>
            <h2 className="t-heading">From Word or a text file</h2>
            <p className="t-small muted mt-1">
              A numbered list, the way a trainer already types one. Word&apos;s own numbering and lettering
              are read, so a document made with the list buttons works as it is.
            </p>
            <pre className="mt-3 overflow-x-auto rounded-[var(--radius-sm)] bg-[var(--surface-2)] p-3 text-xs leading-relaxed">
{`1. Which vitamin is fat soluble?
a) Vitamin C
b) Vitamin D
c) Vitamin B12
Answer: B
Explanation: A, D, E and K are fat soluble.
Tags: nutrition, biochemistry
Difficulty: easy
Marks: 1

2. The heart has four chambers.
Answer: True

3. Name the largest bone in the body.
Marks: 2`}
            </pre>
            <ul className="t-small muted mt-3 space-y-1">
              <li>A star before an option marks it correct instead of an Answer line: <code>*b) Vitamin D</code>.</li>
              <li>Two correct options make a multiple answer question.</li>
              <li>No options and an answer of True or False is a true or false question; no options at all is a written answer.</li>
              <li>Explanation, Tags, Difficulty, Marks and Negative lines are optional. Difficulty defaults to medium, marks to 1.</li>
            </ul>
          </Card>

          <Card>
            <h2 className="t-heading">From a spreadsheet</h2>
            <p className="t-small muted mt-1">
              Save as CSV with a header row. Columns: <code>question</code>, then <code>option_a</code> to{' '}
              <code>option_f</code> (or one <code>options</code> column separated by <code>|</code>),{' '}
              <code>answer</code> (a letter, letters like <code>A,C</code>, or the option text),{' '}
              <code>explanation</code>, <code>difficulty</code>, <code>marks</code>, <code>negative</code>,{' '}
              <code>tags</code>. Only <code>question</code> is required.
            </p>
            <p className="t-small muted mt-2">
              The quickest way to see the format is to{' '}
              <a href={`/admin/question-bank/${bank.id}/export`} className="underline">
                export this bank
              </a>{' '}
              and open the file.
            </p>
          </Card>

          <Card>
            <h2 className="t-heading">Safe to run twice</h2>
            <p className="t-small muted mt-1">
              A question whose text is already in this bank is skipped, so a corrected file can be imported
              again without doubling anything. Lines with problems are listed by number and everything else
              still goes in.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
