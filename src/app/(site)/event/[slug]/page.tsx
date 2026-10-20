import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSiteContext } from '@/lib/site';
import { getSessionUser } from '@/lib/auth';
import { formatMoney } from '@/lib/money';
import { eventBySlug } from '@/lib/event-tickets';
import { NoTenantNotice } from '@/components/tenant-notices';
import { Badge } from '@/components/ui';
import { RegisterPanel } from './register-panel';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const site = await getSiteContext();
  if (!site) return { title: 'Event' };
  const event = await eventBySlug(site.organizationId, slug, null);
  if (!event) return { title: 'Event not found' };
  const description = (event.summary ?? `${event.when}. ${event.isOnline ? 'Online' : (event.venue ?? '')}.`).slice(0, 155);
  return {
    title: `${event.title} | ${site.organization.name}`,
    description,
    alternates: { canonical: `/event/${event.slug}` },
    openGraph: { title: event.title, description, type: 'website' },
  };
}

/**
 * An event's own page: when, where, what it costs, how many places are left,
 * and one button. A registered visitor sees their place, a calendar file and,
 * from half an hour before an online event, the link to join.
 */
export default async function EventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const site = await getSiteContext();
  if (!site) return <NoTenantNotice />;
  const user = await getSessionUser();
  const event = await eventBySlug(site.organizationId, slug, user?.id ?? null);
  if (!event) notFound();

  const price = event.price && event.price.pricePaise > 0 ? formatMoney(event.price.pricePaise, event.price.currency) : 'Free';
  const label = event.isFree ? 'Register, it is free' : `Get a ticket, ${price}`;

  const structured = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: event.title,
    ...(event.startsAt ? { startDate: event.startsAt } : {}),
    ...(event.endsAt ? { endDate: event.endsAt } : {}),
    eventAttendanceMode: event.isOnline ? 'https://schema.org/OnlineEventAttendanceMode' : 'https://schema.org/OfflineEventAttendanceMode',
    eventStatus: 'https://schema.org/EventScheduled',
    location: event.isOnline ? { '@type': 'VirtualLocation', url: `/event/${event.slug}` } : { '@type': 'Place', name: event.venue ?? site.organization.name, address: event.venue ?? '' },
    organizer: { '@type': 'Organization', name: site.organization.name },
    ...(event.summary ? { description: event.summary } : {}),
    offers: {
      '@type': 'Offer',
      price: ((event.price?.pricePaise ?? 0) / 100).toFixed(2),
      priceCurrency: event.price?.currency ?? 'INR',
      availability: event.seatsLeft === 0 ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock',
    },
  };

  return (
    <div className="mx-auto max-w-[64rem] px-4 py-8 sm:px-6 sm:py-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structured).replace(/</g, '\\u003c') }} />
      <p className="t-small faint">
        <Link href="/events" className="underline">All events</Link>
      </p>

      <div className="mt-3 grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {event.phase === 'LIVE' && <Badge tone="ok">happening now</Badge>}
            {event.phase === 'OVER' && <Badge>over</Badge>}
            <Badge tone={event.isOnline ? 'brand' : 'neutral'}>{event.isOnline ? 'online' : 'in person'}</Badge>
          </div>
          <h1 className="t-display mt-2">{event.title}</h1>

          <dl className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="rounded-[var(--radius)] border bg-[var(--surface)] p-4">
              <dt className="t-micro faint">When</dt>
              <dd className="t-body mt-1 font-medium">{event.when}</dd>
            </div>
            <div className="rounded-[var(--radius)] border bg-[var(--surface)] p-4">
              <dt className="t-micro faint">Where</dt>
              <dd className="t-body mt-1 font-medium">{event.isOnline ? 'Online, the link comes with your place' : (event.venue ?? 'To be announced')}</dd>
            </div>
          </dl>

          {event.summary && <p className="t-lead mt-6 max-w-prose whitespace-pre-line">{event.summary}</p>}
        </div>

        <aside className="lg:sticky lg:top-[7.5rem] lg:self-start">
          <div className="rounded-[var(--radius)] border bg-[var(--surface)] p-5 shadow-sm">
            <p className="t-price">{price}</p>
            {event.seatsLeft !== null && !event.registered && (
              <p className="t-small faint mt-1 tabular-nums">
                {event.seatsLeft === 0 ? 'No places left' : `${event.seatsLeft} place${event.seatsLeft === 1 ? '' : 's'} left`}
              </p>
            )}

            <div className="mt-4">
              <RegisterPanel
                productId={event.id}
                signedIn={Boolean(user)}
                registered={event.registered}
                canCancel={event.canCancel}
                closedReason={event.closedReason}
                label={label}
              />
            </div>

            {event.registered && (
              <div className="mt-4 space-y-2 border-t pt-4">
                {event.joinUrl && (
                  <a
                    href={event.joinUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex w-full items-center justify-center rounded-[var(--radius-sm)] bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-[var(--brand-ink)]"
                  >
                    Join now
                  </a>
                )}
                {event.joinLater && <p className="t-small muted">The joining link appears here half an hour before it starts.</p>}
                {event.startsAt && (
                  <a href={`/api/events/${event.slug}/ics`} className="t-small block text-center underline">
                    Add to my calendar
                  </a>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
