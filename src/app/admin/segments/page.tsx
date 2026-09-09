import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { describe, parseRules } from '@/lib/segments';
import { dayKey, formatDayLabel } from '@/lib/clock';
import { Badge, Card, Cell, EmptyState, PageHeader, Row, Table } from '@/components/ui';
import { SegmentActions, NewSegment } from './editors';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * Segments.
 *
 * "Disengaged learners" kept as a list is wrong the day after it is written, so
 * a segment here is a set of conditions and the members are worked out when
 * somebody asks. The count on this screen is the last one computed, and it says
 * when: a number with no date beside it is a number nobody should act on.
 */
export default async function SegmentsPage() {
  const tenant = await requireTenant();
  const me = await requireStaff('marketing.segments', 'view');
  const canEdit = me.permissions['marketing.segments']?.edit ?? false;
  const tz = tenant.timezone;

  const [segments, courses, batches] = await Promise.all([
    db.segment.findMany({
      where: { organizationId: tenant.organizationId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        type: true,
        rules: true,
        memberCount: true,
        lastComputedAt: true,
      },
    }),
    db.product.findMany({
      where: { organizationId: tenant.organizationId, type: 'COURSE', deletedAt: null },
      orderBy: { title: 'asc' },
      select: { id: true, title: true },
    }),
    db.batch.findMany({
      where: { organizationId: tenant.organizationId, deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Segments"
        description="A rule, not a list. Who matches is worked out when you ask, and again when a campaign uses it."
      />

      {segments.length === 0 ? (
        <EmptyState
          title="No segments yet"
          hint="Build one below. Two conditions is usually enough to find the people worth a message."
        />
      ) : (
        <Table head={['Segment', 'Rule', 'Matches', 'Worked out', '']}>
          {segments.map((s) => (
            <Row key={s.id}>
              <Cell>
                <span className="font-medium">{s.name}</span>
                <p className="t-micro faint">{s.type === 'STATIC' ? 'a fixed list' : 'a rule'}</p>
              </Cell>
              <Cell className="muted">
                {s.type === 'STATIC' ? 'People picked by hand' : describe(parseRules(s.rules))}
              </Cell>
              <Cell className="tabular-nums">{s.memberCount}</Cell>
              <Cell className="t-small faint whitespace-nowrap">
                {s.lastComputedAt ? (
                  formatDayLabel(dayKey(s.lastComputedAt, tz), tz)
                ) : (
                  <Badge tone="warn">never</Badge>
                )}
              </Cell>
              <Cell className="text-right">
                {canEdit && <SegmentActions id={s.id} isStatic={s.type === 'STATIC'} />}
              </Cell>
            </Row>
          ))}
        </Table>
      )}

      {canEdit && (
        <Card>
          <h2 className="t-heading">Build a segment</h2>
          <p className="t-small muted mt-1 max-w-prose">
            Conditions are joined with and, or with or. The count is worked out when you save, so
            you see what you have built before anyone uses it.
          </p>
          <div className="mt-4">
            <NewSegment
              courses={courses.map((c) => ({ id: c.id, name: c.title }))}
              batches={batches}
            />
          </div>
        </Card>
      )}
    </div>
  );
}
