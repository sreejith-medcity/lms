import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { permissionFor, reportById } from '@/lib/reports';
import { rangeFrom } from '../../data';
import { Card, Cell, EmptyState, Row, Table } from '@/components/ui';
import { Stat, StatGrid } from '@/components/stat';
import { Definitions } from '@/components/analytics-bits';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const report = reportById(id);
  if (!report) notFound();

  const tenant = await requireTenant();
  await requireStaff(permissionFor(report), 'view');

  const sp = await searchParams;
  const rangeParam = (Array.isArray(sp.range) ? sp.range[0] : sp.range) as string | undefined;
  const { since, days, label } = rangeFrom(rangeParam);

  const result = await report.run({
    organizationId: tenant.organizationId,
    tenantId: tenant.tenantId,
    currency: tenant.currency,
    timeZone: tenant.timezone,
    since,
    days,
  });

  const exportHref = `/admin/analytics/reports/${report.id}/export${
    rangeParam ? `?range=${rangeParam}` : ''
  }`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/admin/analytics/reports" className="t-small faint hover:underline">
            Reports
          </Link>
          <h1 className="t-title mt-1">{report.title}</h1>
          <p className="t-small muted mt-1">
            {report.question}
            {report.ignoresRange
              ? ' · the whole book, not a date range'
              : ` · ${label.toLowerCase()}`}
          </p>
        </div>

        <a
          href={exportHref}
          className="rounded-[var(--radius-sm)] border px-3.5 py-2 text-sm hover:bg-[var(--surface-2)]"
        >
          Export CSV
        </a>
      </div>

      {result.stats && result.stats.length > 0 && (
        <StatGrid>
          {result.stats.map((s) => (
            <Stat key={s.label} label={s.label} value={s.value} sub={s.sub} />
          ))}
        </StatGrid>
      )}

      {result.rows.length === 0 ? (
        <EmptyState
          title="Nothing to show"
          hint={
            report.ignoresRange
              ? 'No records match this report yet.'
              : 'Nothing in this window. Try a longer range.'
          }
        />
      ) : (
        <div className="space-y-3">
          <Table head={result.columns.map((c) => c.label)}>
            {result.rows.slice(0, 300).map((row, i) => (
              <Row key={i}>
                {row.map((cell, j) => (
                  <Cell
                    key={j}
                    className={result.columns[j]?.numeric ? 'tabular-nums' : ''}
                  >
                    {cell ?? '—'}
                  </Cell>
                ))}
              </Row>
            ))}
          </Table>

          {result.rows.length > 300 && (
            <p className="t-small faint">
              Showing the first 300 of {result.rows.length}. The export has all of them.
            </p>
          )}
        </div>
      )}

      {result.note && (
        <Card>
          <p className="t-small muted">{result.note}</p>
        </Card>
      )}

      <Definitions items={report.definitions} />
    </div>
  );
}
