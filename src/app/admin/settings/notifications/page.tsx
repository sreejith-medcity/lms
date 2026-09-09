import Link from 'next/link';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { NOTIFICATION_EVENTS } from '@/lib/notification-events';
import { Card, PageHeader } from '@/components/ui';
import { Matrix } from './matrix';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * Every event by every channel.
 *
 * The grid is the honest shape for this: an academy wants to see at a glance
 * that class reminders go by WhatsApp and nothing else does, and a page of
 * accordions hides exactly that.
 */
export default async function NotificationsSettings() {
  const tenant = await requireTenant();
  const me = await requireStaff('settings.notifications', 'view');
  const canEdit = me.permissions['settings.notifications']?.edit ?? false;

  const [settings, templates] = await Promise.all([
    db.notificationSetting.findMany({
      where: { organizationId: tenant.organizationId, productId: null },
      select: {
        eventKey: true,
        emailEnabled: true,
        smsEnabled: true,
        whatsappEnabled: true,
        pushEnabled: true,
      },
    }),
    db.messageTemplate.findMany({
      where: { organizationId: tenant.organizationId, eventKey: { not: null } },
      select: { eventKey: true, channel: true, name: true },
    }),
  ]);

  const byEvent = new Map(settings.map((s) => [s.eventKey, s]));
  const templatesByEvent = new Map<string, string[]>();
  for (const t of templates) {
    if (!t.eventKey) continue;
    const list = templatesByEvent.get(t.eventKey) ?? [];
    list.push(`${t.name} (${t.channel.toLowerCase()})`);
    templatesByEvent.set(t.eventKey, list);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description="Which events tell people, and on which channel. Nothing sends until a provider is connected; these decide what will."
      />

      <Card>
        <p className="t-small muted">
          A channel switched on with no{' '}
          <Link href="/admin/templates" className="underline">
            message template
          </Link>{' '}
          behind it will fall back to a plain default when sending starts. Writing the template is
          how it sounds like your academy rather than like software.
        </p>
      </Card>

      {NOTIFICATION_EVENTS.map((group) => (
        <Matrix
          key={group.group}
          canEdit={canEdit}
          group={group.group}
          rows={group.events.map((e) => {
            const s = byEvent.get(e.key);
            return {
              key: e.key,
              label: e.label,
              who: e.who,
              live: e.live,
              waitingOn: e.waitingOn ?? null,
              templates: templatesByEvent.get(e.key) ?? [],
              email: s?.emailEnabled ?? true,
              sms: s?.smsEnabled ?? false,
              whatsapp: s?.whatsappEnabled ?? false,
              push: s?.pushEnabled ?? true,
            };
          })}
        />
      ))}
    </div>
  );
}
