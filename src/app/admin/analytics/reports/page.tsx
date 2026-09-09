import Link from 'next/link';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { reportsByCategory } from '@/lib/reports';
import { Card, PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * The report catalogue.
 *
 * Listed by the question each one answers rather than by its title, because
 * nobody goes looking for "collections by branch": they go looking for which
 * branch is bringing the money in.
 */
export default async function ReportsIndex() {
  await requireTenant();
  const me = await requireStaff();

  const categories = reportsByCategory((permission) => me.permissions[permission]?.view ?? false);
  const count = categories.reduce((n, c) => n + c.reports.length, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description={`${count} reports open to you, each one printing what it counts and exporting as it stands.`}
      />

      {categories.length === 0 && (
        <Card>
          <p className="t-small muted">
            Your role does not open any reports. Ask whoever manages roles for reporting access.
          </p>
        </Card>
      )}

      {categories.map((category) => (
        <section key={category.key} className="space-y-3">
          <h2 className="t-heading">{category.label}</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {category.reports.map((report) => (
              <Link key={report.id} href={`/admin/analytics/reports/${report.id}`}>
                <Card className="h-full transition hover:border-[var(--brand)]">
                  <p className="font-medium">{report.title}</p>
                  <p className="t-small muted mt-1">{report.question}</p>
                  {report.ignoresRange && (
                    <p className="t-micro faint mt-2">Whole book, not a date range.</p>
                  )}
                </Card>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
