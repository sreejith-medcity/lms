import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { Card } from '@/components/ui';
import { Stat, StatGrid } from '@/components/stat';
import { ColumnChart, type ColumnPoint } from '@/components/chart';
import { Breakdown, Definitions } from '@/components/analytics-bits';
import { attendanceData, rangeFrom } from '../data';

export const dynamic = 'force-dynamic';

export default async function AttendanceAnalytics({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireTenant();
  await requireStaff('analytics.manage_analytics', 'view');

  const sp = await searchParams;
  const { since, days, label } = rangeFrom(
    (Array.isArray(sp.range) ? sp.range[0] : sp.range) as string | undefined,
  );

  const d = await attendanceData(tenant.organizationId, since, days);

  const chart: ColumnPoint[] = d.series.map((b) => ({
    label: b.start.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
    axisLabel: b.start.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
    value: b.value,
    display: `${b.value} sign-in${b.value === 1 ? '' : 's'}`,
  }));

  return (
    <div className="space-y-6">
      <StatGrid>
        <Stat
          label="Attendance"
          value={d.expected > 0 ? `${d.percent}%` : '—'}
          sub={
            d.expected > 0
              ? `${d.present} of ${d.expected} expected`
              : 'No classes were held in this period'
          }
        />
        <Stat label="Classes held" value={String(d.sessions)} sub={`${d.cancelled} cancelled`} />
        <Stat
          label="On time"
          value={d.present > 0 ? `${d.inTimePercent}%` : '—'}
          sub={d.late > 0 ? `${d.late} joined late` : 'of those who attended'}
        />
        <Stat label="Sign-ins" value={String(d.present)} sub={label.toLowerCase()} />
      </StatGrid>

      <Card>
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="t-heading">Sign-ins</h2>
          <span className="t-small faint">{label.toLowerCase()}</span>
        </div>
        <ColumnChart points={chart} emptyMessage="No classes were held in this period." />
      </Card>

      <Breakdown
        title="Batches needing attention"
        empty="No classes were held in this period."
        rows={d.byBatch.map((b) => ({
          label: b.name,
          value: `${b.percent}%`,
          ratio: b.percent,
          tone: b.percent >= 75 ? 'ok' : b.percent >= 50 ? 'warn' : 'bad',
          sub: `${b.sessions} class${b.sessions === 1 ? '' : 'es'} held`,
        }))}
      />

      <Definitions
        items={[
          [
            'Attendance',
            'Sign-ins as a share of every enrolled learner for every class their batch held. It is measured against who was expected, not against who happened to be marked, which is what stops it reading near enough 100% forever.',
          ],
          [
            'Expected',
            'The batch roster multiplied by the classes it held. Someone who enrolled halfway through the period is still counted against every class in it, so the figure is conservative.',
          ],
          [
            'On time',
            'Of the people who attended, the share who joined within ten minutes of the start. It says nothing about the people who did not attend at all.',
          ],
          [
            'Cancelled',
            'Classes cancelled in the period. They are excluded from attendance entirely rather than counted as everybody absent.',
          ],
        ]}
      />
    </div>
  );
}
