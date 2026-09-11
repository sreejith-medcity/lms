import Link from 'next/link';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { eventDef } from '@/lib/events';
import { ACTION_TYPES } from '@/lib/workflow-rules';
import { RECIPES } from '@/lib/workflow-recipes';
import { runSummary } from '@/lib/workflows';
import { dayKey, formatDayLabel } from '@/lib/clock';
import { Badge, Card, Cell, EmptyState, LinkButton, PageHeader, Row, Table } from '@/components/ui';
import { ActiveToggle } from './[id]/editor';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * Automations.
 *
 * A rule is "when this happens, do these things, in order, with pauses",
 * and this page is the list of them with a switch each. The counts beside
 * a rule are runs, because a rule that is on and has never run is the
 * thing to notice: either nothing has happened yet or the trigger is not
 * what its author thought.
 */
export default async function WorkflowsPage() {
  const tenant = await requireTenant();
  const me = await requireStaff('marketing.workflows', 'view');
  const canEdit = me.permissions['marketing.workflows']?.edit ?? false;
  const tz = tenant.timezone;

  const workflows = await db.workflow.findMany({
    where: { organizationId: tenant.organizationId },
    orderBy: [{ isActive: 'desc' }, { updatedAt: 'desc' }],
    select: {
      id: true,
      name: true,
      triggerType: true,
      isActive: true,
      updatedAt: true,
      steps: { orderBy: { sortOrder: 'asc' }, select: { actionType: true, delayMinutes: true } },
      runs: { orderBy: { startedAt: 'desc' }, take: 1, select: { startedAt: true } },
    },
  });
  const summary = await runSummary(tenant.organizationId, workflows.map((w) => w.id));

  const actionLabel = (key: string) => ACTION_TYPES.find((a) => a.key === key)?.label ?? key;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Automations"
        description="When something happens, do these things in order, with pauses. Messages go through the outbox; tags and follow-ups land where the office already looks."
        action={canEdit ? <LinkButton href="/admin/workflows/new">New automation</LinkButton> : undefined}
      />

      {workflows.length === 0 ? (
        <EmptyState title="No automations yet" hint="Start from one of the recipes below, or from a blank one. Nothing runs until you switch it on." />
      ) : (
        <Table head={['Automation', 'When', 'Then', 'Runs', 'Last run', '']}>
          {workflows.map((w) => {
            const s = summary[w.id];
            return (
              <Row key={w.id}>
                <Cell>
                  <Link href={`/admin/workflows/${w.id}`} className="font-medium hover:underline">
                    {w.name}
                  </Link>
                  <p className="t-micro faint mt-0.5">
                    {w.isActive ? <Badge tone="ok">on</Badge> : <Badge tone="neutral">off</Badge>}
                  </p>
                </Cell>
                <Cell className="muted">{eventDef(w.triggerType)?.label ?? w.triggerType}</Cell>
                <Cell className="t-small muted">
                  {w.steps.slice(0, 4).map((st) => actionLabel(st.actionType)).join(' → ')}
                  {w.steps.length > 4 ? ` → ${w.steps.length - 4} more` : ''}
                </Cell>
                <Cell className="t-small tabular-nums">
                  {s.done + s.stopped + s.running + s.failed === 0 ? (
                    <span className="faint">none yet</span>
                  ) : (
                    <>
                      {s.done} done
                      {s.running > 0 && <span className="faint"> · {s.running} under way</span>}
                      {s.stopped > 0 && <span className="faint"> · {s.stopped} stopped</span>}
                      {s.failed > 0 && <span className="text-[var(--bad)]"> · {s.failed} failed</span>}
                    </>
                  )}
                </Cell>
                <Cell className="t-small faint whitespace-nowrap">
                  {w.runs[0] ? formatDayLabel(dayKey(w.runs[0].startedAt, tz), tz) : '—'}
                </Cell>
                <Cell>{canEdit && <ActiveToggle id={w.id} active={w.isActive} />}</Cell>
              </Row>
            );
          })}
        </Table>
      )}

      {canEdit && (
        <section>
          <h2 className="text-base font-semibold">Recipes</h2>
          <p className="t-small faint mt-0.5">Complete automations an academy actually runs. Open one, change the wording, switch it on.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {RECIPES.map((r) => (
              <Link key={r.key} href={`/admin/workflows/new?recipe=${r.key}`} className="group block">
                <Card className="h-full transition group-hover:border-[var(--brand)]">
                  <p className="t-eyebrow" style={{ color: 'var(--brand)' }}>
                    {eventDef(r.triggerType)?.label ?? r.triggerType}
                  </p>
                  <p className="mt-1 font-semibold">{r.name}</p>
                  <p className="t-small muted mt-1.5 leading-relaxed">{r.blurb}</p>
                  <p className="t-micro faint mt-3">{r.steps.length} steps</p>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
