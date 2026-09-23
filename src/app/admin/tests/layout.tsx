import { PageHeader } from '@/components/ui';
import { requireStaffAny } from '@/lib/auth';
import { ANY_TEST_PERM } from '@/lib/exams/perms';
import { TestsTabs } from './tabs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Mock tests', robots: { index: false, follow: false } };

export default async function TestsLayout({ children }: { children: React.ReactNode }) {
  await requireStaffAny(ANY_TEST_PERM);
  return (
    <div>
      <PageHeader
        title="Mock tests"
        description="Full papers in each exam's own format, sat here on the clock. Objective parts count at once; writing and speaking are marked by the model and a tutor's mark wins."
      />
      <TestsTabs />
      <div className="mt-6">{children}</div>
    </div>
  );
}
