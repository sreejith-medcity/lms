import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { DOMAIN_EVENTS, eventDef } from '@/lib/events';
import { ACTION_TYPES, parseTriggerFilters } from '@/lib/workflow-rules';
import { recipeFor } from '@/lib/workflow-recipes';
import { Badge, Card } from '@/components/ui';
import { ActiveToggle, TestRun, WorkflowEditor, type EditorStep } from './editor';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

const when = (d: Date) => d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export default async function WorkflowPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ recipe?: string }>;
}) {
  const [{ id }, { recipe: recipeKey }] = await Promise.all([params, searchParams]);
  const tenant = await requireTenant();
  const me = await requireStaff('marketing.workflows', 'view');
  const canEdit = me.permissions['marketing.workflows']?.edit ?? false;
  const isNew = id === 'new';

  const [workflow, products, batches, templates, learners] = await Promise.all([
    isNew
      ? null
      : db.workflow.findFirst({
          where: { id, organizationId: tenant.organizationId },
          include: {
            steps: { orderBy: { sortOrder: 'asc' } },
            runs: { orderBy: { startedAt: 'desc' }, take: 25, select: { id: true, userId: true, status: true, currentStep: true, startedAt: true, completedAt: true, nextAt: true, log: true, error: true, context: true } },
          },
        }),
    db.product.findMany({ where: { organizationId: tenant.organizationId, deletedAt: null }, orderBy: { title: 'asc' }, select: { id: true, title: true } }),
    db.batch.findMany({ where: { organizationId: tenant.organizationId, deletedAt: null, status: { in: ['ACTIVE', 'UPCOMING'] } }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    db.messageTemplate.findMany({ where: { organizationId: tenant.organizationId, channel: { in: ['EMAIL', 'SMS', 'WHATSAPP'] } }, orderBy: { name: 'asc' }, select: { id: true, name: true, channel: true } }),
    db.user.findMany({ where: { organizationId: tenant.organizationId, kind: 'LEARNER' }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, name: true, email: true } }),
  ]);
  if (!isNew && !workflow) notFound();

  const recipe = isNew ? recipeFor(recipeKey) : null;
  const filters = parseTriggerFilters(workflow?.triggerConfig);
  const steps: EditorStep[] = workflow
    ? workflow.steps.map((s) => ({ actionType: s.actionType, delayMinutes: s.delayMinutes, config: (s.config ?? {}) as Record<string, unknown> }))
    : (recipe?.steps ?? []);

  const learnerNames = new Map(learners.map((l) => [l.id, l.name]));
  const runUsers = workflow ? await db.user.findMany({ where: { id: { in: workflow.runs.map((r) => r.userId).filter((u): u is string => Boolean(u)) } }, select: { id: true, name: true } }) : [];
  for (const u of runUsers) learnerNames.set(u.id, u.name);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href="/admin/workflows" className="t-small faint hover:underline">
          Automations
        </Link>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <h1 className="t-title flex items-center gap-2">
            {workflow?.name ?? recipe?.name ?? 'New automation'}
            {workflow && (workflow.isActive ? <Badge tone="ok">on</Badge> : <Badge tone="neutral">off</Badge>)}
          </h1>
          {workflow && canEdit && <ActiveToggle id={workflow.id} active={workflow.isActive} />}
        </div>
        {workflow && (
          <p className="t-small faint mt-1">
            {eventDef(workflow.triggerType)?.label ?? workflow.triggerType} · {workflow.steps.length} step{workflow.steps.length === 1 ? '' : 's'}
          </p>
        )}
      </div>

      <WorkflowEditor
        workflow={
          workflow
            ? { id: workflow.id, name: workflow.name, description: workflow.description ?? '', triggerType: workflow.triggerType, runOnce: workflow.runOnce }
            : recipe
              ? { id: null, name: recipe.name, description: recipe.description, triggerType: recipe.triggerType, runOnce: recipe.runOnce }
              : null
        }
        filters={filters}
        steps={steps}
        events={DOMAIN_EVENTS.map((e) => ({ key: e.key, label: e.label, group: e.group, filters: e.filters }))}
        actions={ACTION_TYPES.map((a) => ({ key: a.key, label: a.label, blurb: a.blurb }))}
        products={products}
        batches={batches}
        templates={templates}
        canEdit={canEdit}
      />

      {workflow && canEdit && (
        <Card>
          <p className="font-semibold">Try it on one learner</p>
          <p className="t-small faint mt-0.5">
            A real run, now, as if the trigger had just fired for them: messages are queued, tags go on, points are given. Steps behind a delay wait for it.
          </p>
          <div className="mt-3">
            <TestRun id={workflow.id} learners={learners.map((l) => ({ id: l.id, label: l.email ? `${l.name} · ${l.email}` : l.name }))} />
          </div>
        </Card>
      )}

      {workflow && (
        <section>
          <h2 className="text-base font-semibold">Recent runs</h2>
          {workflow.runs.length === 0 ? (
            <p className="t-small faint mt-1">Nothing has run yet.</p>
          ) : (
            <div className="mt-3 overflow-hidden rounded-[var(--radius)] border">
              <ul className="divide-y">
                {workflow.runs.map((r) => {
                  const log = Array.isArray(r.log) ? (r.log as { step: number; action: string; at: string; note: string }[]) : [];
                  const ctx = (r.context ?? {}) as { test?: boolean; item?: string };
                  return (
                    <li key={r.id} className="px-4 py-3">
                      <details>
                        <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="text-sm font-medium">{r.userId ? (learnerNames.get(r.userId) ?? 'A learner') : 'An enquiry'}</span>
                          {ctx.item && <span className="t-small faint">{ctx.item}</span>}
                          {ctx.test && <Badge tone="brand">test</Badge>}
                          <span className="ml-auto flex items-center gap-2">
                            {r.status === 'RUNNING' && <Badge tone="warn">step {r.currentStep + 1} due {when(r.nextAt)}</Badge>}
                            {r.status === 'DONE' && <Badge tone="ok">done</Badge>}
                            {r.status === 'STOPPED' && <Badge tone="neutral">stopped</Badge>}
                            {r.status === 'FAILED' && <Badge tone="bad">failed</Badge>}
                            <span className="t-small faint whitespace-nowrap">{when(r.startedAt)}</span>
                          </span>
                        </summary>
                        <ol className="t-small mt-2 space-y-1 pl-1">
                          {log.length === 0 && <li className="faint">No step has run yet.</li>}
                          {log.map((line, i) => (
                            <li key={i} className="flex gap-2">
                              <span className="faint w-28 shrink-0 tabular-nums">{when(new Date(line.at))}</span>
                              <span>
                                <span className="font-medium">{ACTION_TYPES.find((a) => a.key === line.action)?.label ?? line.action}</span>
                                <span className="muted"> · {line.note}</span>
                              </span>
                            </li>
                          ))}
                          {r.error && <li className="text-[var(--bad)]">{r.error}</li>}
                        </ol>
                      </details>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
