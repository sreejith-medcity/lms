import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { Card } from '@/components/ui';
import { Stat, StatGrid } from '@/components/stat';
import { ColumnChart, type ColumnPoint } from '@/components/chart';
import { Breakdown, Definitions } from '@/components/analytics-bits';
import { learningData, rangeFrom } from '../data';

export const dynamic = 'force-dynamic';

export default async function LearningAnalytics({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireTenant();
  await requireStaff('analytics.learner_analytics', 'view');

  const sp = await searchParams;
  const { since, days, label } = rangeFrom(
    (Array.isArray(sp.range) ? sp.range[0] : sp.range) as string | undefined,
  );

  const d = await learningData(tenant.organizationId, since, days);

  const chart: ColumnPoint[] = d.series.map((b) => ({
    label: b.start.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
    axisLabel: b.start.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
    value: b.value,
    display: `${b.value} enrolment${b.value === 1 ? '' : 's'}`,
  }));

  const topCourse = d.byCourse[0]?.learners ?? 1;

  return (
    <div className="space-y-6">
      <StatGrid>
        <Stat label="New enrolments" value={String(d.enrolments)} sub={label.toLowerCase()} />
        <Stat label="Completions" value={String(d.completions)} sub={label.toLowerCase()} />
        <Stat label="Active learners" value={String(d.active)} sub="opened something in the period" />
        <Stat
          label="Average score"
          value={d.averageScore != null ? `${d.averageScore}%` : '—'}
          sub={
            d.attemptsCount > 0
              ? `${d.attemptsCount} marked attempt${d.attemptsCount === 1 ? '' : 's'}, ${d.passRate}% passed`
              : 'No marked attempts yet'
          }
        />
      </StatGrid>

      <Card>
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="t-heading">Enrolments</h2>
          <span className="t-small faint">{label.toLowerCase()}</span>
        </div>
        <ColumnChart points={chart} emptyMessage="Nobody enrolled in this period." />
      </Card>

      <Breakdown
        title="Courses by learners, and how far they get"
        empty="No enrolments yet."
        rows={d.byCourse.map((c) => ({
          label: c.title,
          value: `${c.learners} learner${c.learners === 1 ? '' : 's'}`,
          ratio: (c.learners / topCourse) * 100,
          sub: `${c.progress}% average progress`,
        }))}
      />

      <Definitions
        items={[
          [
            'New enrolments',
            'Enrolments created in this period, however they came about: online checkout, manual enrolment, or a free course.',
          ],
          [
            'Completions',
            'Enrolments that reached every lesson in this period. A course finished today counts here even if it was started last year.',
          ],
          [
            'Active learners',
            'Enrolments with any recorded activity in the period. One person on three courses counts three times, because it measures course engagement rather than headcount.',
          ],
          [
            'Average score',
            'The mean across attempts that have been fully marked. A paper still waiting on a trainer is excluded rather than counted as zero.',
          ],
          [
            'Average progress',
            'Lessons completed as a share of lessons in the course, averaged across everyone enrolled including those who have not started.',
          ],
        ]}
      />
    </div>
  );
}
