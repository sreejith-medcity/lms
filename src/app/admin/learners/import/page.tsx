import Link from 'next/link';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { Card, PageHeader } from '@/components/ui';
import { Importer } from './importer';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function ImportPage() {
  const tenant = await requireTenant();
  await requireStaff('new_enrollment.bulk', 'edit');

  const courses = await db.product.findMany({
    where: { organizationId: tenant.organizationId, type: 'COURSE', deletedAt: null },
    orderBy: { title: 'asc' },
    select: { title: true },
  });

  return (
    <div>
      <PageHeader
        title="Import learners"
        description="Checked before anything is written. The first pass reads the file, validates every row and tells you exactly what it would do; only then can you apply it."
        action={
          <Link href="/admin/learners" className="t-small faint hover:underline">
            Learners →
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Importer />

        <Card>
          <h2 className="t-heading">The file</h2>
          <p className="t-small muted mt-1">
            A header row, then one learner per line. Save as CSV from Excel or Sheets.
          </p>

          <pre className="mt-4 overflow-x-auto rounded-[var(--radius-sm)] border bg-[var(--surface-2)] p-3 text-xs">
{`name,email,phone,course
Aparna Menon,aparna@example.com,9876543210,German Language - A1
Rahul Nair,rahul@example.com,,`}
          </pre>

          <ul className="t-small muted mt-4 space-y-2">
            <li>
              <span className="font-medium">name</span> is required. One of{' '}
              <span className="font-medium">email</span> or{' '}
              <span className="font-medium">phone</span> is required.
            </li>
            <li>
              <span className="font-medium">course</span> is optional. Leave it blank to create the
              account without enrolling anyone.
            </li>
            <li>
              An email that already exists is matched to that account rather than duplicating it.
            </li>
            <li>
              New accounts get a one-time password, listed in the result so you can pass them on.
              Email is not connected, so nothing is sent.
            </li>
          </ul>

          {courses.length > 0 && (
            <>
              <p className="t-small mt-4 font-medium">Course names it will recognise</p>
              <ul className="t-small faint mt-1 space-y-0.5">
                {courses.map((c) => (
                  <li key={c.title}>{c.title}</li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
