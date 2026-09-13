import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { getPlatformUser } from '@/lib/platform/session';
import { formatMoney } from '@/lib/money';
import { Card, PageHeader } from '@/components/ui';
import { PlanForm, type PlanDraft } from './editors';

export const dynamic = 'force-dynamic';

export default async function PlansPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await getPlatformUser();
  if (!me) redirect('/platform/login');
  const sp = await searchParams;
  const editId = typeof sp.edit === 'string' ? sp.edit : '';
  const plans = await db.plan.findMany({ orderBy: { sortOrder: 'asc' }, select: { id: true, code: true, name: true, description: true, monthlyPaise: true, quarterlyPaise: true, annualPaise: true, trialDays: true, isPublic: true, isActive: true, limits: true, features: true, _count: { select: { subscriptions: true } } } });
  const editing = plans.find((p) => p.id === editId);
  const draft: PlanDraft | null = editing
    ? {
        id: editing.id, code: editing.code, name: editing.name, description: editing.description ?? '', monthly: editing.monthlyPaise / 100, quarterly: (editing.quarterlyPaise ?? 0) / 100, annual: (editing.annualPaise ?? 0) / 100, trialDays: editing.trialDays, isPublic: editing.isPublic, isActive: editing.isActive,
        limits: Object.fromEntries(editing.limits.map((l) => { const scale = l.metric === 'STORAGE_BYTES' ? 1024 ** 3 : 1; return [l.metric, { included: Number(l.included) / scale, cap: l.hardCap === null ? 0 : Number(l.hardCap) / scale, overage: l.overagePaisePerUnit / 100 }]; })),
        features: Object.fromEntries(editing.features.map((f) => [f.feature, f.enabled])),
      }
    : null;

  return (
    <div className="space-y-6">
      <PageHeader title="Plans" description="What an academy can buy. Prices, what is included, what a hard cap refuses and what overage bills." />
      <div className="grid gap-3 md:grid-cols-3">
        {plans.map((p) => (
          <Card key={p.id} className={p.isActive ? '' : 'opacity-70'}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-medium">{p.name} <span className="t-small faint font-mono">{p.code}</span></p>
                <p className="text-lg font-semibold tabular-nums">{formatMoney(p.monthlyPaise)}<span className="t-small faint font-normal"> / month</span></p>
              </div>
              <a href={`/platform/plans?edit=${p.id}`} className="rounded-[var(--radius-sm)] border px-2.5 py-1 text-xs hover:bg-[var(--surface-2)]">Edit</a>
            </div>
            {p.description && <p className="t-small muted mt-1">{p.description}</p>}
            <p className="t-micro faint mt-2">{p._count.subscriptions} subscriber{p._count.subscriptions === 1 ? '' : 's'} · {p.isPublic ? 'public' : 'hidden'} · {p.trialDays} day trial</p>
          </Card>
        ))}
      </div>
      <Card>
        <h2 className="t-heading">{draft ? `Editing: ${draft.name}` : 'Add a plan'}</h2>
        <div className="mt-4"><PlanForm key={draft?.id ?? 'new'} draft={draft} /></div>
      </Card>
    </div>
  );
}
