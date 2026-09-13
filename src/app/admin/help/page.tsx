import Link from 'next/link';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { formatDateTime } from '@/lib/clock';
import { STATUS_LABEL_STAFF, categoryLabel, statusTone, waitingDays, waitingLabel, type HelpStatus } from '@/lib/help-desk';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { Stat, StatGrid } from '@/components/stat';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * The help queue. What the office owes a reply on comes first, oldest
 * first, because a question three days old is the one that becomes a
 * phone call. Staff on a branch see their branch; everyone else sees all.
 */
export default async function HelpQueue({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const tenant = await requireTenant();
  const me = await requireStaff('learner.learner_management', 'view');
  const sp = await searchParams;
  const show = typeof sp.show === 'string' ? sp.show : 'open';
  const branchFilter = typeof sp.branch === 'string' ? sp.branch : '';
  const mineOnly = sp.mine === '1';
  const now = new Date();

  const branchScope = me.branchIds.length > 0 && me.restrictBatchAccess ? { in: me.branchIds } : undefined;
  const where = {
    organizationId: tenant.organizationId,
    ...(branchScope ? { branchId: branchScope } : branchFilter ? { branchId: branchFilter } : {}),
    ...(mineOnly ? { assigneeId: me.id } : {}),
    status: show === 'all' ? undefined : show === 'waiting' ? ('WAITING_ON_LEARNER' as const) : show === 'done' ? { in: ['RESOLVED', 'CLOSED'] as HelpStatus[] } : ('OPEN' as const),
  };

  const [tickets, counts, branches] = await Promise.all([
    db.helpTicket.findMany({
      where,
      orderBy: [{ priority: 'desc' }, { lastMessageAt: 'asc' }],
      take: 100,
      select: { id: true, subject: true, category: true, status: true, priority: true, lastMessageAt: true, lastFromStaff: true, user: { select: { name: true } }, branch: { select: { name: true } }, assigneeId: true, _count: { select: { messages: true } } },
    }),
    db.helpTicket.groupBy({ by: ['status'], where: { organizationId: tenant.organizationId, ...(branchScope ? { branchId: branchScope } : {}) }, _count: true }),
    db.branch.findMany({ where: { organizationId: tenant.organizationId, isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ]);
  const count = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;
  const assigneeIds = Array.from(new Set(tickets.map((t) => t.assigneeId).filter((x): x is string => Boolean(x))));
  const assignees = assigneeIds.length ? await db.user.findMany({ where: { organizationId: tenant.organizationId, id: { in: assigneeIds } }, select: { id: true, name: true } }) : [];
  const nameOf = new Map(assignees.map((a) => [a.id, a.name]));
  const oldest = tickets.filter((t) => t.status === 'OPEN').reduce((n, t) => Math.max(n, waitingDays(t.lastMessageAt, t.status, now)), 0);

  const link = (over: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ show, branch: branchFilter, mine: mineOnly ? '1' : undefined, ...over })) if (v) params.set(k, v);
    const s = params.toString();
    return s ? `/admin/help?${s}` : '/admin/help';
  };
  const tab = (key: string, label: string, n?: number) => (
    <Link href={link({ show: key })} className={`rounded-full border px-3 py-1 text-sm ${show === key ? 'border-[var(--brand)] bg-[var(--brand-soft)]' : 'hover:bg-[var(--surface-2)]'}`}>
      {label}{n !== undefined ? ` ${n}` : ''}
    </Link>
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Help desk" description="Questions from learners, from Help in their portal. Oldest unanswered first; a reply goes to them by email and in the portal." />

      <StatGrid>
        <Stat label="Needs a reply" value={String(count('OPEN'))} sub={oldest > 0 ? `the oldest has waited ${waitingLabel(oldest)}` : 'nothing waiting'} />
        <Stat label="Waiting on learners" value={String(count('WAITING_ON_LEARNER'))} />
        <Stat label="Resolved" value={String(count('RESOLVED'))} sub="not yet closed by the learner" />
        <Stat label="Closed" value={String(count('CLOSED'))} />
      </StatGrid>

      <div className="flex flex-wrap items-center gap-2">
        {tab('open', 'Needs a reply', count('OPEN'))}
        {tab('waiting', 'Waiting on learner', count('WAITING_ON_LEARNER'))}
        {tab('done', 'Done')}
        {tab('all', 'All')}
        <span className="mx-1 faint">·</span>
        <Link href={link({ mine: mineOnly ? undefined : '1' })} className={`rounded-full border px-3 py-1 text-sm ${mineOnly ? 'border-[var(--brand)] bg-[var(--brand-soft)]' : 'hover:bg-[var(--surface-2)]'}`}>Mine</Link>
        {!branchScope && branches.length > 1 && (
          <form action="/admin/help" method="get" className="ml-auto">
            <input type="hidden" name="show" value={show} />
            <select name="branch" defaultValue={branchFilter} className="rounded-[var(--radius-sm)] border bg-[var(--surface)] px-2 py-1 text-sm">
              <option value="">Every branch</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
            <button type="submit" className="ml-2 rounded-[var(--radius-sm)] border px-2.5 py-1 text-sm hover:bg-[var(--surface-2)]">Go</button>
          </form>
        )}
      </div>

      {tickets.length === 0 ? (
        <EmptyState title="Nothing here" hint={show === 'open' ? 'Every question has a reply.' : 'No tickets match.'} />
      ) : (
        <Card padded={false}>
          <ul className="divide-y">
            {tickets.map((t) => {
              const days = waitingDays(t.lastMessageAt, t.status, now);
              return (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/admin/help/${t.id}`} className="font-medium hover:underline">{t.subject}</Link>
                      {t.priority === 'HIGH' && <Badge tone="bad">urgent</Badge>}
                    </div>
                    <p className="t-small faint">
                      {t.user.name} · {categoryLabel(t.category)}{t.branch ? ` · ${t.branch.name}` : ''} · {t._count.messages} message{t._count.messages === 1 ? '' : 's'}
                      {t.assigneeId ? ` · with ${nameOf.get(t.assigneeId) ?? 'someone'}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`t-small tabular-nums ${days >= 2 ? 'text-[var(--bad)]' : 'faint'}`}>
                      {t.status === 'OPEN' ? `waiting ${waitingLabel(days)}` : formatDateTime(t.lastMessageAt, tenant.timezone)}
                    </span>
                    <Badge tone={statusTone(t.status)}>{STATUS_LABEL_STAFF[t.status as HelpStatus] ?? t.status}</Badge>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
