import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { Stat, StatGrid } from '@/components/stat';
import { LeadList } from './editors';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

const OPEN_STAGES = ['NEW', 'CONTACTED', 'QUALIFIED', 'DEMO_BOOKED', 'NEGOTIATION'] as const;

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireTenant();
  const me = await requireStaff('leads_and_enquiries.manage_leads', 'view');
  const canEdit = me.permissions['leads_and_enquiries.manage_leads']?.edit ?? false;

  const sp = await searchParams;
  const stage = (Array.isArray(sp.stage) ? sp.stage[0] : sp.stage) as string | undefined;

  const where = {
    organizationId: tenant.organizationId,
    ...(stage && stage !== 'ALL' ? { stage: stage as (typeof OPEN_STAGES)[number] } : {}),
  };

  const [leads, counts, overdue, learners] = await Promise.all([
    db.lead.findMany({
      where,
      orderBy: [{ stage: 'asc' }, { createdAt: 'desc' }],
      take: 100,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        message: true,
        interestedIn: true,
        source: true,
        stage: true,
        createdAt: true,
        ownerId: true,
        convertedUserId: true,
        owner: { select: { name: true } },
        followUps: {
          where: { status: 'PENDING' },
          orderBy: { dueAt: 'asc' },
          take: 1,
          select: { id: true, dueAt: true, note: true },
        },
        activities: {
          orderBy: { createdAt: 'desc' },
          take: 4,
          select: { id: true, type: true, payload: true, createdAt: true },
        },
      },
    }),
    db.lead.groupBy({
      by: ['stage'],
      where: { organizationId: tenant.organizationId },
      _count: { _all: true },
    }),
    db.followUp.count({
      where: {
        lead: { organizationId: tenant.organizationId },
        status: 'PENDING',
        dueAt: { lt: new Date() },
      },
    }),
    db.user.findMany({
      where: { organizationId: tenant.organizationId, kind: 'LEARNER', deletedAt: null },
      orderBy: { name: 'asc' },
      take: 300,
      select: { id: true, name: true, email: true },
    }),
  ]);

  const countOf = (s: string) => counts.find((c) => c.stage === s)?._count._all ?? 0;
  const open = OPEN_STAGES.reduce((n, s) => n + countOf(s), 0);
  const won = countOf('WON');
  const lost = countOf('LOST');
  const closed = won + lost;

  return (
    <div>
      <PageHeader
        title="Enquiries"
        description="Everything the contact form brings in, and what became of it. Deliberately small: a full CRM is a different product, and the part only this system can do is knowing which enquiry became which learner."
      />

      <div className="space-y-6">
        <StatGrid>
          <Stat label="Open" value={String(open)} sub="not yet won or lost" />
          <Stat label="Follow-ups overdue" value={String(overdue)} sub="past their due date" />
          <Stat label="Won" value={String(won)} sub="linked to a learner" />
          <Stat
            label="Conversion"
            value={closed > 0 ? `${Math.round((won / closed) * 100)}%` : '—'}
            sub={closed > 0 ? `of ${closed} closed` : 'nothing closed yet'}
          />
        </StatGrid>

        {leads.length === 0 ? (
          <EmptyState
            title={stage && stage !== 'ALL' ? 'None at this stage' : 'No enquiries yet'}
            hint="The contact form on the public site writes straight into this list."
          />
        ) : (
          <LeadList
            leads={leads.map((l) => ({
              id: l.id,
              name: l.name,
              email: l.email,
              phone: l.phone,
              message: l.message,
              interestedIn: l.interestedIn,
              source: l.source,
              stage: l.stage,
              createdAt: l.createdAt.toISOString(),
              owner: l.owner?.name ?? null,
              converted: Boolean(l.convertedUserId),
              followUp: l.followUps[0]
                ? {
                    id: l.followUps[0].id,
                    dueAt: l.followUps[0].dueAt.toISOString(),
                    note: l.followUps[0].note,
                  }
                : null,
              activities: l.activities.map((a) => ({
                id: a.id,
                type: a.type,
                body:
                  typeof a.payload === 'object' && a.payload && 'body' in a.payload
                    ? String((a.payload as Record<string, unknown>).body)
                    : null,
                to:
                  typeof a.payload === 'object' && a.payload && 'to' in a.payload
                    ? String((a.payload as Record<string, unknown>).to)
                    : null,
                at: a.createdAt.toISOString(),
              })),
            }))}
            learners={learners}
            canEdit={canEdit}
          />
        )}

        {counts.length > 0 && (
          <Card>
            <h2 className="t-heading">Where everything sits</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {counts
                .sort((a, b) => b._count._all - a._count._all)
                .map((c) => (
                  <Badge
                    key={c.stage}
                    tone={c.stage === 'WON' ? 'ok' : c.stage === 'LOST' ? 'bad' : 'neutral'}
                  >
                    {c.stage.toLowerCase().replace('_', ' ')} · {c._count._all}
                  </Badge>
                ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
