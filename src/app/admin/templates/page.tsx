import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { CHANNEL_LABELS, preview } from '@/lib/templates';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { TemplateCard, NewTemplate } from './editors';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * The words, kept apart from the sending.
 *
 * A template is written once and used by campaigns and by the automatic
 * notices. Keeping them here rather than inside each campaign is what stops
 * four slightly different versions of the same reminder existing at once.
 */
export default async function TemplatesPage() {
  const tenant = await requireTenant();
  const me = await requireStaff('email.manage_templates', 'view');
  const canEdit = me.permissions['email.manage_templates']?.edit ?? false;

  const templates = await db.messageTemplate.findMany({
    where: { organizationId: tenant.organizationId },
    orderBy: [{ channel: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      channel: true,
      subject: true,
      body: true,
      variables: true,
      eventKey: true,
      _count: { select: { campaigns: true } },
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Message templates"
        description="Written once, used by campaigns and by the automatic notices. Nothing is sent from here."
      />

      {templates.length === 0 ? (
        <EmptyState
          title="No templates yet"
          hint="Write one below. Use the variables listed and they are filled in per person."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {templates.map((t) => (
            <TemplateCard
              key={t.id}
              canEdit={canEdit}
              template={{
                id: t.id,
                name: t.name,
                channel: t.channel,
                channelLabel: CHANNEL_LABELS[t.channel] ?? t.channel,
                subject: t.subject,
                body: t.body,
                variables: t.variables,
                usedBy: t._count.campaigns,
                preview: preview(t.body, tenant.name),
              }}
            />
          ))}
        </div>
      )}

      {canEdit && (
        <Card>
          <h2 className="t-heading">Write a template</h2>
          <div className="mt-4">
            <NewTemplate academy={tenant.name} />
          </div>
        </Card>
      )}
    </div>
  );
}
