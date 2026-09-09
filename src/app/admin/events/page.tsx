import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { formatMoney } from '@/lib/money';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { EventForm } from './editors';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireTenant();
  await requireStaff('courses.events', 'view');

  const sp = await searchParams;
  const editing = (Array.isArray(sp.edit) ? sp.edit[0] : sp.edit) as string | undefined;

  const events = await db.product.findMany({
    where: { organizationId: tenant.organizationId, type: 'EVENT', deletedAt: null },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      slug: true,
      status: true,
      event: true,
      pricingPlans: { where: { isActive: true }, take: 1, select: { pricePaise: true, currency: true } },
      _count: { select: { enrollments: true } },
    },
  });

  const current = events.find((e) => e.id === editing);

  return (
    <div>
      <PageHeader
        title="Events"
        description="Workshops, seminars, open days. An event is a product like a course is, so it gets the same checkout, the same entitlement and the same invoice rather than its own half-copy of them."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-3">
          {events.length === 0 ? (
            <EmptyState title="No events yet" hint="A one-off session people register for." />
          ) : (
            events.map((e) => {
              const seatsLeft =
                e.event?.capacity != null ? e.event.capacity - e._count.enrollments : null;
              const past = e.event?.startsAt != null && e.event.startsAt < new Date();

              return (
                <Card key={e.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <a href={`/admin/events?edit=${e.id}`} className="font-medium hover:underline">
                          {e.title}
                        </a>
                        <Badge tone={e.status === 'PUBLISHED' ? 'ok' : 'neutral'}>
                          {e.status.toLowerCase()}
                        </Badge>
                        {past && <Badge tone="neutral">past</Badge>}
                        {e.event?.isOnline ? (
                          <Badge tone="brand">online</Badge>
                        ) : (
                          <Badge tone="neutral">in person</Badge>
                        )}
                      </div>

                      <p className="t-small faint mt-1">
                        {e.event?.startsAt?.toLocaleString('en-IN', {
                          weekday: 'short',
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                        {e.event?.venue ? ` · ${e.event.venue}` : ''}
                      </p>

                      <p className="t-small faint mt-1 tabular-nums">
                        {e.pricingPlans[0]
                          ? e.pricingPlans[0].pricePaise === 0
                            ? 'Free'
                            : formatMoney(e.pricingPlans[0].pricePaise, e.pricingPlans[0].currency)
                          : 'No price'}
                        {' · '}
                        {e._count.enrollments} registered
                        {seatsLeft != null ? `, ${Math.max(0, seatsLeft)} seats left` : ''}
                      </p>
                    </div>
                  </div>
                </Card>
              );
            })
          )}
        </div>

        <Card>
          <h2 className="t-heading">{current ? `Edit ${current.title}` : 'New event'}</h2>
          <div className="mt-5">
            <EventForm
              event={
                current
                  ? {
                      id: current.id,
                      title: current.title,
                      startsAt: current.event?.startsAt?.toISOString() ?? '',
                      endsAt: current.event?.endsAt?.toISOString() ?? '',
                      isOnline: current.event?.isOnline ?? true,
                      venue: current.event?.venue ?? '',
                      capacity: current.event?.capacity ?? 0,
                      status: current.status,
                    }
                  : undefined
              }
            />
          </div>
        </Card>
      </div>
    </div>
  );
}
