import Link from 'next/link';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { addDays, dayEnd, dayStart, formatDayLabel, formatTime, todayKey, weekStart } from '@/lib/clock';
import { agendaFor } from '@/lib/agenda-data';
import { calendarToken, groupByDay, type AgendaItem } from '@/lib/agenda';
import { organizationOrigin } from '@/lib/org-origin';
import { Badge } from '@/components/ui';
import { JoinButton } from '../join-button';
import { FeedLink } from './feed-link';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Calendar' };

/**
 * The learner's week: classes, one-to-one lessons, homework due and tests
 * closing, on the academy's clock, with a feed address so the same week
 * lands in the phone's own calendar.
 */
export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const tenant = await requireTenant();
  const user = await getSessionUser();
  if (!user) return null;
  const tz = tenant.timezone;
  const { week } = await searchParams;
  const today = todayKey(tz);
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(week ?? '') ? weekStart(week!) : weekStart(today);
  const days = Array.from({ length: 7 }, (_, i) => addDays(anchor, i));

  const [items, org] = await Promise.all([
    agendaFor({ organizationId: tenant.organizationId, userId: user.id, from: dayStart(days[0], tz), to: dayEnd(days[6], tz), timeZone: tz }),
    db.organization.findUnique({ where: { id: tenant.organizationId }, select: { name: true } }),
  ]);
  const byDay = groupByDay(items, days);
  const origin = await organizationOrigin(tenant.organizationId);
  const feedUrl = `${origin}/api/calendar/${user.id}/${calendarToken(user.id, process.env.AUTH_SECRET || 'insecure-development-secret')}.ics`;

  return (
    <div className="mx-auto max-w-6xl px-5 py-7">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Calendar</h1>
          <p className="t-small faint mt-1">
            {formatDayLabel(days[0], tz)} to {formatDayLabel(days[6], tz)} · {org?.name}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/learn/calendar?week=${addDays(anchor, -7)}`} className="rounded-[var(--radius-sm)] border px-3 py-1.5 text-sm hover:bg-[var(--surface-2)]">
            ← Previous
          </Link>
          <Link href="/learn/calendar" className="rounded-[var(--radius-sm)] border px-3 py-1.5 text-sm hover:bg-[var(--surface-2)]">
            This week
          </Link>
          <Link href={`/learn/calendar?week=${addDays(anchor, 7)}`} className="rounded-[var(--radius-sm)] border px-3 py-1.5 text-sm hover:bg-[var(--surface-2)]">
            Next →
          </Link>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-7">
        {days.map((day) => {
          const list = byDay.get(day) ?? [];
          const isToday = day === today;
          return (
            <section key={day} className={`rounded-[var(--radius)] border bg-[var(--surface)] p-3 ${isToday ? 'border-[var(--brand)]' : ''}`}>
              <h2 className={`t-small mb-2 font-semibold ${isToday ? 'text-[var(--brand)]' : ''}`}>
                {formatDayLabel(day, tz)}
                {isToday && <span className="faint font-normal"> · today</span>}
              </h2>
              {list.length === 0 ? (
                <p className="t-small faint">Nothing</p>
              ) : (
                <ul className="space-y-2">
                  {list.map((it) => (
                    <li key={it.id}>
                      <Item item={it} tz={tz} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      <div className="mt-6 rounded-[var(--radius)] border bg-[var(--surface)] p-4">
        <p className="font-medium">In your phone's calendar</p>
        <p className="t-small muted mt-1">Subscribe to this address and every class, due date and test window appears in Google Calendar, Apple Calendar or Outlook, and stays up to date on its own. Keep it to yourself: anyone with the address sees your timetable.</p>
        <div className="mt-3">
          <FeedLink url={feedUrl} />
        </div>
      </div>
    </div>
  );
}

function Item({ item, tz }: { item: AgendaItem; tz: string }) {
  const tone = item.kind === 'HOLIDAY' ? 'warn' : item.status === 'CANCELLED' ? 'bad' : item.status === 'LIVE' ? 'brand' : item.kind === 'ASSIGNMENT_DUE' || item.kind === 'ASSESSMENT_CLOSES' ? 'warn' : 'neutral';
  const sessionId = item.id.startsWith('session:') ? item.id.slice(8) : null;
  return (
    <div className={`rounded-[var(--radius-sm)] border p-2 ${item.status === 'CANCELLED' ? 'opacity-60' : ''}`}>
      <p className="t-micro faint tabular-nums">
        {item.allDay ? 'All day' : `${formatTime(item.startsAt, tz)}${item.endsAt > item.startsAt ? ` to ${formatTime(item.endsAt, tz)}` : ''}`}
      </p>
      <p className="t-small font-medium leading-snug">{item.url && item.kind !== 'CLASS' && item.kind !== 'ONE_TO_ONE' ? <Link href={item.url} className="hover:underline">{item.title}</Link> : item.title}</p>
      {item.detail && <p className="t-micro faint truncate">{item.detail}</p>}
      <div className="mt-1.5 flex items-center gap-2">
        <Badge tone={tone}>{item.kind === 'HOLIDAY' ? 'holiday' : item.status === 'CANCELLED' ? 'cancelled' : item.status === 'LIVE' ? 'live now' : item.kind === 'ONE_TO_ONE' ? 'one to one' : item.kind === 'ASSIGNMENT_DUE' ? 'homework' : item.kind === 'ASSESSMENT_CLOSES' ? 'test' : 'class'}</Badge>
        {sessionId && item.status !== 'CANCELLED' && item.status !== 'DONE' && item.joinUrl && <JoinButton sessionId={sessionId} live={item.status === 'LIVE'} />}
      </div>
    </div>
  );
}
