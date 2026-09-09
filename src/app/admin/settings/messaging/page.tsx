import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { db } from '@/lib/db';
import { channelReadiness } from '@/lib/messaging';
import { outboxSummary } from '@/lib/messaging/drain';
import { walletFor, spentSince } from '@/lib/messaging/wallet';
import { formatPaise } from '@/lib/messaging/pricing';
import { PageHeader, Card, Badge } from '@/components/ui';
import { Stat, StatGrid } from '@/components/stat';
import { MessagingPanel } from './panel';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * Whether messages are actually going out.
 *
 * The screen that did not exist while the outbox was only queueing. Three
 * questions, in the order somebody asks them: can we send at all, what is
 * waiting, and what has it cost.
 */
export default async function MessagingPage() {
  const tenant = await requireTenant();
  const me = await requireStaff('settings.integrations', 'view');
  const canEdit = me.permissions['settings.integrations']?.edit ?? false;

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [readiness, outbox, wallet, spent, recent] = await Promise.all([
    channelReadiness(tenant.organizationId),
    outboxSummary(tenant.organizationId),
    walletFor(tenant.organizationId),
    spentSince(tenant.organizationId, monthStart),
    db.notificationLog.findMany({
      where: { organizationId: tenant.organizationId },
      orderBy: { createdAt: 'desc' },
      take: 25,
      select: {
        id: true,
        channel: true,
        eventKey: true,
        target: true,
        status: true,
        provider: true,
        error: true,
        costPaise: true,
        attempts: true,
        createdAt: true,
        sentAt: true,
      },
    }),
  ]);

  const anyReady = Object.values(readiness).some((row) => row.ready);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Messaging"
        description="What can send, what is waiting, and what it has cost. Nothing on this page is an estimate except the money, which says so."
      />

      {!anyReady && (
        <Card>
          <p className="font-medium">Nothing can send yet.</p>
          <p className="t-small muted mt-1">
            Messages are still being queued and none of them are lost, but no provider is connected,
            so they sit here. Connect one in Settings, Integrations and press Send now.
          </p>
        </Card>
      )}

      <StatGrid>
        <Stat label="Waiting" value={outbox.queued} sub="queued, not yet sent" />
        <Stat
          label="Sent today"
          value={outbox.sentToday}
          sub={outbox.failed ? `${outbox.failed} failed and still failed` : 'nothing has failed'}
        />
        <Stat
          label="Credit"
          value={formatPaise(wallet.balancePaise)}
          sub={wallet.low ? 'below the warning level' : 'estimated, not billed'}
        />
        <Stat label="Spent this month" value={formatPaise(spent)} sub="on this estimate" />
      </StatGrid>

      <section className="space-y-3">
        <div>
          <h2 className="t-heading">Channels</h2>
          <p className="t-small muted">
            The first connected provider for each channel carries it. Connecting a second changes
            nothing until the first is removed.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {Object.entries(readiness).map(([channel, row]) => (
            <Card key={channel}>
              <p className="flex items-center gap-2 font-medium">
                {channel === 'EMAIL' ? 'Email' : channel === 'SMS' ? 'SMS' : 'WhatsApp'}
                {row.ready ? <Badge tone="ok">ready</Badge> : <Badge tone="neutral">no provider</Badge>}
              </p>
              <p className="t-small muted mt-1">
                {row.ready ? `Sending through ${row.provider}.` : row.reason}
              </p>
              {channel === 'WHATSAPP' && row.ready && (
                <p className="t-small faint mt-1">
                  Only templates Meta has approved go out beyond the 24 hour window, so an event
                  with no template name will not send on this channel.
                </p>
              )}
            </Card>
          ))}
        </div>
      </section>

      <MessagingPanel
        canEdit={canEdit}
        wallet={{
          balance: formatPaise(wallet.balancePaise),
          lowRupees: (wallet.lowBalancePaise / 100).toFixed(2),
          floorRupees: (wallet.floorPaise / 100).toFixed(2),
          low: wallet.low,
        }}
        failed={outbox.failed}
        recent={recent.map((row) => ({
          id: row.id,
          channel: row.channel,
          eventKey: row.eventKey,
          target: row.target,
          status: row.status,
          provider: row.provider,
          error: row.error,
          cost: formatPaise(row.costPaise),
          attempts: row.attempts,
          at: (row.sentAt ?? row.createdAt).toISOString(),
        }))}
      />
    </div>
  );
}
