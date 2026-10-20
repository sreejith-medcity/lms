import Link from 'next/link';
import type { Metadata } from 'next';
import { getSiteContext } from '@/lib/site';
import { getSessionUser } from '@/lib/auth';
import { formatMoney } from '@/lib/money';
import { upcomingEvents } from '@/lib/event-tickets';
import { NoTenantNotice } from '@/components/tenant-notices';
import { Badge, EmptyState } from '@/components/ui';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const site = await getSiteContext();
  return {
    title: site ? `Events | ${site.organization.name}` : 'Events',
    description: 'Workshops, open days and webinars coming up.',
    alternates: { canonical: '/events' },
  };
}

export default async function EventsPage() {
  const site = await getSiteContext();
  if (!site) return <NoTenantNotice />;
  const user = await getSessionUser();
  const events = await upcomingEvents(site.organizationId, user?.id ?? null);

  return (
    <div className="mx-auto max-w-[64rem] px-4 py-8 sm:px-6 sm:py-10">
      <h1 className="t-display">Events</h1>
      <p className="t-lead mt-2 max-w-prose">Workshops, open days and webinars at {site.organization.name}.</p>

      {events.length === 0 ? (
        <div className="mt-8">
          <EmptyState title="Nothing coming up just now" hint="New events appear here as soon as they are announced." />
        </div>
      ) : (
        <ul className="mt-8 divide-y overflow-hidden rounded-[var(--radius)] border bg-[var(--surface)]">
          {events.map((e) => (
            <li key={e.id}>
              <Link href={`/event/${e.slug}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-[var(--surface-2)]">
                <div className="min-w-0">
                  <p className="font-semibold">{e.title}</p>
                  <p className="t-small faint mt-0.5">
                    {e.when} · {e.isOnline ? 'Online' : (e.venue ?? 'Venue to be announced')}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {e.registered && <Badge tone="ok">you are going</Badge>}
                  {e.phase === 'LIVE' && <Badge tone="ok">happening now</Badge>}
                  {!e.registered && e.seatsLeft === 0 && <Badge tone="warn">full</Badge>}
                  <span className="t-small font-semibold tabular-nums">
                    {e.price && e.price.pricePaise > 0 ? formatMoney(e.price.pricePaise, e.price.currency) : 'Free'}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
