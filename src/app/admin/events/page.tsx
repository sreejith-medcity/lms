import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { formatMoney } from '@/lib/money';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { EventForm } from './editors';
import { HOLDS_SEAT, seatsLeftLabel } from '@/lib/seats';
import { toLocalInput } from '@/lib/clock';
import { eventWhen } from '@/lib/event-rules';
import { eventRegistrants } from '@/lib/event-tickets';

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
      _count: { select: { enrollments: { where: HOLDS_SEAT } } },
    },
  });

  const current = events.find((e) => e.id === editing);
  const registrants = current ? await eventRegistrants(tenant.organizationId, current.id) : [];
  const zone = tenant.timezone;

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
              const seatsLeft = seatsLeftLabel({ id: e.id, capacity: e.event?.capacity ?? null, taken: e._count.enrollments });
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
                        {eventWhen(e.event?.startsAt ?? null, e.event?.endsAt ?? null, zone)}
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
                        {seatsLeft ? `, ${seatsLeft}` : ''}
                      </p>
                    </div>
                    {e.status === 'PUBLISHED' && (
                      <a href={`/event/${e.slug}`} target="_blank" rel="noopener" className="t-small underline">
                        Public page
                      </a>
                    )}
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
                      startsAt: toLocalInput(current.event?.startsAt, zone),
                      endsAt: toLocalInput(current.event?.endsAt, zone),
                      isOnline: current.event?.isOnline ?? true,
                      venue: current.event?.venue ?? '',
                      summary: current.event?.summary ?? '',
                      joinUrl: current.event?.joinUrl ?? '',
                      capacity: current.event?.capacity ?? 0,
                      priceRupees: (current.pricingPlans[0]?.pricePaise ?? 0) / 100,
                      status: current.status,
                    }
                  : undefined
              }
            />
          </div>

          {current && (
            <div className="mt-8 border-t pt-5">
              <h3 className="t-title">
                Who is coming <span className="faint tabular-nums">{registrants.length}</span>
              </h3>
              {registrants.length === 0 ? (
                <p className="t-small faint mt-2">Nobody has a place yet.</p>
              ) : (
                <ul className="mt-3 divide-y rounded-[var(--radius-sm)] border">
                  {registrants.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2">
                      <a href={`/admin/learners/${r.user.id}`} className="text-sm font-medium hover:underline">
                        {r.user.name}
                      </a>
                      <span className="t-small faint">
                        {[r.user.phone, r.user.email].filter(Boolean).join(' · ')}
                        {r.pricingPlan && r.pricingPlan.pricePaise > 0 ? ` · ${formatMoney(r.pricingPlan.pricePaise, r.pricingPlan.currency)}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
