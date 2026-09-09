import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { AnnouncementForm, DeleteAnnouncement } from './editors';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function AnnouncementsPage() {
  const tenant = await requireTenant();
  await requireStaff('announcements.manage_announcements', 'view');

  const [announcements, batches] = await Promise.all([
    db.announcement.findMany({
      where: { organizationId: tenant.organizationId },
      orderBy: { publishAt: 'desc' },
      take: 50,
      select: {
        id: true,
        title: true,
        bodyHtml: true,
        urgency: true,
        publishAt: true,
        targets: { select: { batchId: true, batch: { select: { name: true } } } },
      },
    }),
    db.batch.findMany({
      where: {
        organizationId: tenant.organizationId,
        deletedAt: null,
        status: { in: ['UPCOMING', 'ACTIVE'] },
      },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, course: { select: { product: { select: { title: true } } } } },
    }),
  ]);

  return (
    <div>
      <PageHeader
        title="Announcements"
        description="Posted to the batches they apply to, and shown inside the platform. Nothing is emailed or messaged: those channels are not connected yet, and a notice that claims to have been sent when it was not is worse than none."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-3">
          {announcements.length === 0 ? (
            <EmptyState
              title="Nothing posted yet"
              hint="A class moved, an exam date, a holiday. Targeted at the batches it affects."
            />
          ) : (
            announcements.map((a) => {
              const everyone = a.targets.every((t) => !t.batchId);
              const future = a.publishAt > new Date();

              return (
                <Card key={a.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{a.title}</p>
                        {a.urgency === 'HIGH' && <Badge tone="bad">urgent</Badge>}
                        {future && <Badge tone="warn">scheduled</Badge>}
                      </div>
                      <p className="t-small faint mt-1">
                        {a.publishAt.toLocaleString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                        {' · '}
                        {everyone
                          ? 'everyone'
                          : a.targets
                              .map((t) => t.batch?.name)
                              .filter(Boolean)
                              .join(', ')}
                      </p>
                      <p className="t-small muted mt-2 whitespace-pre-wrap">{a.bodyHtml}</p>
                    </div>
                    <DeleteAnnouncement id={a.id} />
                  </div>
                </Card>
              );
            })
          )}
        </div>

        <Card>
          <h2 className="t-heading">New announcement</h2>
          <div className="mt-5">
            <AnnouncementForm
              batches={batches.map((b) => ({
                id: b.id,
                name: `${b.name} · ${b.course.product.title}`,
              }))}
            />
          </div>
        </Card>
      </div>
    </div>
  );
}
