import Link from 'next/link';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { Card, PageHeader } from '@/components/ui';
import { PaperGenerator } from './generator';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function GeneratePaperPage({
  searchParams,
}: {
  searchParams: Promise<{ bank?: string }>;
}) {
  const tenant = await requireTenant();
  await requireStaff('courses.assessments', 'edit');
  const { bank } = await searchParams;

  const [banks, tagRows] = await Promise.all([
    db.questionBank.findMany({
      where: { organizationId: tenant.organizationId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, _count: { select: { questions: true } } },
    }),
    db.question.findMany({ where: { bank: { organizationId: tenant.organizationId } }, select: { tags: true } }),
  ]);

  const counts = new Map<string, number>();
  for (const row of tagRows) for (const t of row.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  const tags = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  return (
    <div>
      <PageHeader
        title="Generate a paper"
        description="A mock paper drawn from the bank by a recipe: so many questions with these tags, at this difficulty, from these banks. The recipe is kept on the paper so another variant can be drawn later."
        action={
          <Link href="/admin/assessments" className="t-small underline">
            All assessments
          </Link>
        }
      />

      {tagRows.length === 0 ? (
        <Card>
          <p className="t-small muted">
            The bank is empty. <Link href="/admin/question-bank" className="underline">Write or import questions</Link>{' '}
            first; tagging them is what makes a recipe possible.
          </p>
        </Card>
      ) : (
        <PaperGenerator
          banks={banks.map((b) => ({ id: b.id, name: b.name, count: b._count.questions }))}
          tags={tags}
          defaultBankId={banks.some((b) => b.id === bank) ? bank : undefined}
        />
      )}
    </div>
  );
}
