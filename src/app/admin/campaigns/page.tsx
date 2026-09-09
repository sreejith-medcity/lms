import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { AUDIENCES, CHANNEL_LABELS } from '@/lib/templates';
import { dayKey, formatDayLabel } from '@/lib/clock';
import { Badge, Card, Cell, EmptyState, PageHeader, Row, Table } from '@/components/ui';
import { Stat, StatGrid } from '@/components/stat';
import { CampaignActions, NewCampaign } from './editors';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

function audienceLabel(segmentId: string | null, names: Map<string, string>) {
  if (!segmentId) return 'Every learner';
  const [kind, id] = segmentId.split(':');
  const base = AUDIENCES.find((a) => a.value === kind)?.label ?? kind;
  return id ? `${base}: ${names.get(id) ?? 'gone'}` : base;
}

/**
 * Campaigns, composed here and sent in Phase 7.
 *
 * The screen is honest about that: a prepared campaign says how many people it
 * would reach and how many it cannot, and nothing anywhere claims to have sent.
 */
export default async function CampaignsPage() {
  const tenant = await requireTenant();
  const me = await requireStaff('marketing.campaigns', 'view');
  const canEdit = me.permissions['marketing.campaigns']?.edit ?? false;
  const tz = tenant.timezone;

  const [campaigns, templates, batches, courses] = await Promise.all([
    db.campaign.findMany({
      where: { organizationId: tenant.organizationId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        name: true,
        channel: true,
        status: true,
        segmentId: true,
        scheduledAt: true,
        sentCount: true,
        createdAt: true,
        template: { select: { name: true } },
        _count: { select: { recipients: true } },
      },
    }),
    db.messageTemplate.findMany({
      where: { organizationId: tenant.organizationId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, channel: true },
    }),
    db.batch.findMany({
      where: { organizationId: tenant.organizationId, deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    db.product.findMany({
      where: { organizationId: tenant.organizationId, type: 'COURSE', deletedAt: null },
      orderBy: { title: 'asc' },
      select: { id: true, title: true },
    }),
  ]);

  const names = new Map<string, string>([
    ...batches.map((b) => [b.id, b.name] as const),
    ...courses.map((c) => [c.id, c.title] as const),
  ]);

  const queued = campaigns.reduce((n, c) => n + c._count.recipients, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Campaigns"
        description="Write it, work out who it reaches, and queue it. Sending waits on a messaging provider."
      />

      <StatGrid>
        <Stat label="Campaigns" value={campaigns.length} sub={`${templates.length} templates`} />
        <Stat
          label="Queued"
          value={queued}
          sub="people across every prepared campaign"
        />
        <Stat
          label="Scheduled"
          value={campaigns.filter((c) => c.status === 'SCHEDULED').length}
          sub="waiting on a provider"
        />
        <Stat label="Sent" value={campaigns.reduce((n, c) => n + c.sentCount, 0)} sub="all time" />
      </StatGrid>

      {templates.length === 0 && (
        <Card>
          <p className="t-small muted">
            Write a message template first — a campaign is a template plus an audience.
          </p>
        </Card>
      )}

      {campaigns.length === 0 ? (
        <EmptyState title="No campaigns yet" hint="Compose one below once you have a template." />
      ) : (
        <Table head={['Campaign', 'Channel', 'Audience', 'Reaches', 'State', 'When', '']}>
          {campaigns.map((c) => (
            <Row key={c.id}>
              <Cell>
                <span className="font-medium">{c.name}</span>
                <p className="t-micro faint">{c.template?.name ?? 'template gone'}</p>
              </Cell>
              <Cell className="muted">{CHANNEL_LABELS[c.channel] ?? c.channel}</Cell>
              <Cell className="muted">{audienceLabel(c.segmentId, names)}</Cell>
              <Cell className="tabular-nums">
                {c._count.recipients > 0 ? c._count.recipients : <span className="faint">not worked out</span>}
              </Cell>
              <Cell>
                <Badge
                  tone={
                    c.status === 'SENT'
                      ? 'ok'
                      : c.status === 'SCHEDULED'
                        ? 'brand'
                        : c.status === 'FAILED'
                          ? 'bad'
                          : 'neutral'
                  }
                >
                  {c.status.toLowerCase()}
                </Badge>
              </Cell>
              <Cell className="t-small faint whitespace-nowrap">
                {c.scheduledAt
                  ? formatDayLabel(dayKey(c.scheduledAt, tz), tz)
                  : formatDayLabel(dayKey(c.createdAt, tz), tz)}
              </Cell>
              <Cell className="text-right">
                {canEdit && (
                  <CampaignActions
                    id={c.id}
                    status={c.status}
                    recipients={c._count.recipients}
                    sent={c.sentCount > 0}
                  />
                )}
              </Cell>
            </Row>
          ))}
        </Table>
      )}

      {canEdit && templates.length > 0 && (
        <Card>
          <h2 className="t-heading">Compose a campaign</h2>
          <p className="t-small muted mt-1 max-w-prose">
            Working out the audience is its own press, so you can see the number before anything is
            scheduled.
          </p>
          <div className="mt-4">
            <NewCampaign
              templates={templates}
              batches={batches}
              courses={courses.map((c) => ({ id: c.id, name: c.title }))}
            />
          </div>
        </Card>
      )}
    </div>
  );
}
