import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import {
  addDays,
  addMonths,
  dayEnd,
  dayKey,
  dayStart,
  formatMonthLabel,
  formatDayLabel,
  monthGrid,
  todayKey,
  weekStart,
} from '@/lib/clock';
import { PageHeader } from '@/components/ui';
import { CalendarControls, HolidayForm } from './controls';
import { MonthView, TimeGridView, ListView, type CalendarEvent } from './views';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

type View = 'month' | 'week' | 'day' | 'list';

const VIEWS: View[] = ['month', 'week', 'day', 'list'];

/**
 * The timetable.
 *
 * This is the screen a trainer lives in, so it answers the trainer's question
 * first: what is on, and is any of it mine. Everything else on it — the batch
 * and trainer filters, the holiday marker — is there because the alternative is
 * a spreadsheet somebody keeps privately.
 */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string; batch?: string; trainer?: string }>;
}) {
  const params = await searchParams;
  const tenant = await requireTenant();
  const me = await requireStaff('scheduling.calendar', 'view');
  const canEdit = me.permissions['scheduling.mark_holiday']?.edit ?? false;
  const tz = tenant.timezone;

  const view: View = VIEWS.includes(params.view as View) ? (params.view as View) : 'week';
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? '') ? params.date! : todayKey(tz);
  const batchId = params.batch || '';
  const trainerId = params.trainer || '';

  // Each view asks for exactly the days it draws, so a month never loads a year.
  const days =
    view === 'month'
      ? monthGrid(anchor)
      : view === 'week'
        ? Array.from({ length: 7 }, (_, i) => addDays(weekStart(anchor), i))
        : view === 'day'
          ? [anchor]
          : Array.from({ length: 30 }, (_, i) => addDays(anchor, i));

  const from = dayStart(days[0], tz);
  const to = dayEnd(days[days.length - 1], tz);

  const [sessions, batches, trainerRows] = await Promise.all([
    db.liveSession.findMany({
      where: {
        organizationId: tenant.organizationId,
        startsAt: { gte: from, lt: to },
        ...(batchId ? { batchId } : {}),
        ...(trainerId
          ? {
              OR: [
                { batch: { staff: { some: { userId: trainerId } } } },
                { instructors: { some: { userId: trainerId } } },
              ],
            }
          : {}),
      },
      orderBy: { startsAt: 'asc' },
      take: 600,
      select: {
        id: true,
        title: true,
        startsAt: true,
        endsAt: true,
        status: true,
        isHoliday: true,
        learner: { select: { name: true } },
        batch: {
          select: {
            id: true,
            name: true,
            staff: { select: { userId: true, role: true } },
            _count: { select: { enrollments: true } },
          },
        },
        _count: { select: { attendances: true } },
      },
    }),
    db.batch.findMany({
      where: { organizationId: tenant.organizationId, deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    // BatchStaff carries no relation to User, so the names come in one pass here
    // rather than a join per session.
    db.batchStaff.findMany({
      where: { batch: { organizationId: tenant.organizationId, deletedAt: null } },
      select: { userId: true },
      distinct: ['userId'],
    }),
  ]);

  const staffNames = new Map(
    (
      await db.user.findMany({
        where: {
          id: { in: trainerRows.map((t) => t.userId) },
          organizationId: tenant.organizationId,
          deletedAt: null,
        },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      })
    ).map((u) => [u.id, u.name] as const),
  );
  const trainers = [...staffNames].map(([id, name]) => ({ id, name }));

  const events: CalendarEvent[] = sessions.map((s) => ({
    id: s.id,
    title: s.title,
    startsAt: s.startsAt.toISOString(),
    endsAt: s.endsAt.toISOString(),
    day: dayKey(s.startsAt, tz),
    status: s.status,
    isHoliday: s.isHoliday,
    // A one-to-one class has no batch, so it says whose class it is instead.
    batchName: s.batch?.name ?? (s.learner ? `1:1 · ${s.learner.name}` : 'One to one'),
    trainer:
      staffNames.get(
        s.batch?.staff.find((x) => x.userId === trainerId)?.userId ??
          s.batch?.staff.find((x) => x.role === 'PRIMARY_TUTOR')?.userId ??
          s.batch?.staff[0]?.userId ??
          '',
      ) ?? null,
    signedIn: s._count.attendances,
    roster: s.batch?._count.enrollments ?? 1,
  }));

  const label =
    view === 'month'
      ? formatMonthLabel(anchor, tz)
      : view === 'day'
        ? formatDayLabel(anchor, tz, true)
        : view === 'week'
          ? `${formatDayLabel(days[0], tz)} to ${formatDayLabel(days[6], tz)}`
          : `${formatDayLabel(days[0], tz)} onwards`;

  const step = view === 'month' ? null : view === 'day' ? 1 : view === 'week' ? 7 : 30;
  const prev = step ? addDays(anchor, -step) : addMonths(anchor, -1);
  const next = step ? addDays(anchor, step) : addMonths(anchor, 1);

  const held = events.filter((e) => e.status !== 'CANCELLED' && new Date(e.startsAt) <= new Date());
  const expected = held.reduce((n, e) => n + e.roster, 0);
  const signedIn = held.reduce((n, e) => n + e.signedIn, 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Calendar"
        description="Every class in one place, by day, week or month, and filtered down to one batch or one trainer."
      />

      <CalendarControls
        view={view}
        label={label}
        prev={prev}
        next={next}
        today={todayKey(tz)}
        batchId={batchId}
        trainerId={trainerId}
        batches={batches}
        trainers={trainers}
      />

      <p className="t-small faint">
        {events.length} {events.length === 1 ? 'class' : 'classes'} in view
        {held.length > 0 && expected > 0
          ? ` · ${Math.round((signedIn / expected) * 100)}% turned up to the ${held.length} already held`
          : ''}
      </p>

      {view === 'month' && <MonthView days={days} anchor={anchor} today={todayKey(tz)} events={events} />}
      {(view === 'week' || view === 'day') && (
        <TimeGridView days={days} today={todayKey(tz)} events={events} timeZone={tz} />
      )}
      {view === 'list' && <ListView days={days} events={events} timeZone={tz} />}

      {canEdit && (
        <HolidayForm
          batches={batches}
          defaultDate={anchor}
          scopedBatchId={batchId}
        />
      )}
    </div>
  );
}
