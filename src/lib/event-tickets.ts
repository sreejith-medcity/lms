import { db } from '@/lib/db';
import { happened, notifyLearner } from '@/lib/events';
import { HOLDS_SEAT } from '@/lib/seats';
import { eventPhase, eventWhen, joinLinkOpen, registrationProblem, seatsLeft, type EventFacts, type EventPhase } from '@/lib/event-rules';

/**
 * Registering for an event, shared by the public page, its server actions and
 * the app's API so the three cannot disagree. A free event is registered for
 * here; a paid one goes through checkout like a course, and checkout asks
 * `eventProblem` before it takes any money.
 */

export type Outcome = { ok: true; message: string } | { ok: false; error: string };

const eventSelect = {
  id: true,
  title: true,
  slug: true,
  status: true,
  event: { select: { startsAt: true, endsAt: true, isOnline: true, venue: true, capacity: true, summary: true, joinUrl: true } },
  pricingPlans: {
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' as const },
    take: 1,
    select: { id: true, pricePaise: true, currency: true },
  },
  _count: { select: { enrollments: { where: HOLDS_SEAT } } },
} as const;

type Row = {
  id: string;
  title: string;
  slug: string;
  status: string;
  event: { startsAt: Date | null; endsAt: Date | null; isOnline: boolean; venue: string | null; capacity: number | null; summary: string | null; joinUrl: string | null } | null;
  pricingPlans: { id: string; pricePaise: number; currency: string }[];
  _count: { enrollments: number };
};

function factsOf(row: Row): EventFacts {
  return {
    published: row.status === 'PUBLISHED',
    startsAt: row.event?.startsAt ?? null,
    endsAt: row.event?.endsAt ?? null,
    capacity: row.event?.capacity ?? null,
    taken: row._count.enrollments,
  };
}

/** What the page and the app show. The join link only for someone registered, and only near the time. */
export interface EventView {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  startsAt: string | null;
  endsAt: string | null;
  when: string;
  isOnline: boolean;
  venue: string | null;
  phase: EventPhase;
  seatsLeft: number | null;
  price: { planId: string; pricePaise: number; currency: string } | null;
  isFree: boolean;
  registered: boolean;
  /** A free registration the person may give up; a paid one goes through the office. */
  canCancel: boolean;
  /** Why registering is not possible now, or null. */
  closedReason: string | null;
  joinUrl: string | null;
  /** True when there is a link but it is too early to show it. */
  joinLater: boolean;
}

function viewOf(row: Row, timeZone: string, registration: { pricePaise: number } | null, now: Date): EventView {
  const facts = factsOf(row);
  const plan = row.pricingPlans[0] ?? null;
  const isFree = !plan || plan.pricePaise <= 0;
  const open = joinLinkOpen(facts, now);
  const registered = Boolean(registration);
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    summary: row.event?.summary ?? null,
    startsAt: facts.startsAt?.toISOString() ?? null,
    endsAt: facts.endsAt?.toISOString() ?? null,
    when: eventWhen(facts.startsAt, facts.endsAt, timeZone),
    isOnline: row.event?.isOnline ?? true,
    venue: row.event?.venue ?? null,
    phase: eventPhase(facts, now),
    seatsLeft: seatsLeft(facts),
    price: plan ? { planId: plan.id, pricePaise: plan.pricePaise, currency: plan.currency } : null,
    isFree,
    registered,
    canCancel: registered && (registration?.pricePaise ?? 0) <= 0 && eventPhase(facts, now) === 'UPCOMING',
    closedReason: registered ? null : registrationProblem(facts, now),
    joinUrl: registered && open && row.event?.isOnline ? (row.event.joinUrl ?? null) : null,
    joinLater: registered && !open && Boolean(row.event?.isOnline && row.event.joinUrl) && eventPhase(facts, now) === 'UPCOMING',
  };
}

async function registrationOf(organizationId: string, userId: string | null, productIds: string[]) {
  if (!userId || !productIds.length) return new Map<string, { pricePaise: number }>();
  const rows = await db.enrollment.findMany({
    where: { organizationId, userId, productId: { in: productIds }, ...HOLDS_SEAT },
    select: { productId: true, pricingPlan: { select: { pricePaise: true } } },
  });
  return new Map(rows.map((r) => [r.productId, { pricePaise: r.pricingPlan?.pricePaise ?? 0 }]));
}

async function timeZoneOf(organizationId: string): Promise<string> {
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
  return org?.timezone ?? 'Asia/Calcutta';
}

/** One published event by its slug, as the visitor should see it. */
export async function eventBySlug(organizationId: string, slug: string, userId: string | null, now = new Date()): Promise<EventView | null> {
  const row = await db.product.findFirst({
    where: { organizationId, slug, type: 'EVENT', status: 'PUBLISHED', deletedAt: null },
    select: eventSelect,
  });
  if (!row?.event) return null;
  const [mine, zone] = await Promise.all([registrationOf(organizationId, userId, [row.id]), timeZoneOf(organizationId)]);
  return viewOf(row, zone, mine.get(row.id) ?? null, now);
}

/** Published events that have not finished, soonest first. */
export async function upcomingEvents(organizationId: string, userId: string | null, now = new Date()): Promise<EventView[]> {
  const rows = await db.product.findMany({
    where: {
      organizationId,
      type: 'EVENT',
      status: 'PUBLISHED',
      deletedAt: null,
      // Ends after now, or (with no end) started within the default length.
      event: { OR: [{ endsAt: { gt: now } }, { endsAt: null, startsAt: { gt: new Date(now.getTime() - 3 * 3600_000) } }] },
    },
    select: eventSelect,
    take: 50,
  });
  const [mine, zone] = await Promise.all([registrationOf(organizationId, userId, rows.map((r) => r.id)), timeZoneOf(organizationId)]);
  return rows
    .filter((r) => r.event)
    .map((r) => viewOf(r, zone, mine.get(r.id) ?? null, now))
    .filter((v) => v.phase !== 'OVER')
    .sort((a, b) => (a.startsAt ?? '').localeCompare(b.startsAt ?? ''));
}

/** The events this person is registered for that have not finished. */
export async function myEvents(organizationId: string, userId: string, now = new Date()): Promise<EventView[]> {
  const rows = await db.enrollment.findMany({
    where: { organizationId, userId, ...HOLDS_SEAT, product: { type: 'EVENT', deletedAt: null } },
    select: { productId: true },
  });
  if (!rows.length) return [];
  const products = await db.product.findMany({
    where: { organizationId, id: { in: rows.map((r) => r.productId) } },
    select: eventSelect,
  });
  const [mine, zone] = await Promise.all([registrationOf(organizationId, userId, products.map((p) => p.id)), timeZoneOf(organizationId)]);
  return products
    .filter((p) => p.event)
    .map((p) => viewOf(p, zone, mine.get(p.id) ?? null, now))
    .filter((v) => v.phase !== 'OVER')
    .sort((a, b) => (a.startsAt ?? '').localeCompare(b.startsAt ?? ''));
}

/**
 * Checkout's question: is there anything stopping this event being bought
 * now? Null for anything that is not an event.
 */
export async function eventProblem(organizationId: string, productId: string, now = new Date()): Promise<string | null> {
  const row = await db.product.findFirst({ where: { id: productId, organizationId, type: 'EVENT' }, select: eventSelect });
  if (!row?.event) return null;
  return registrationProblem(factsOf(row), now);
}

/**
 * A free registration. The count and the new row sit under one lock per event,
 * so two people taking the last seat at the same moment cannot both get it.
 */
export async function registerFree(organizationId: string, userId: string, productId: string, now = new Date()): Promise<Outcome> {
  const row = await db.product.findFirst({
    where: { id: productId, organizationId, type: 'EVENT', deletedAt: null },
    select: eventSelect,
  });
  if (!row?.event) return { ok: false, error: 'Event not found.' };
  const plan = row.pricingPlans[0] ?? null;
  if (plan && plan.pricePaise > 0) return { ok: false, error: 'This event is paid for at checkout.' };

  const branch = await db.branch.findFirst({
    where: { organizationId, isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!branch) return { ok: false, error: 'This academy has no branch configured.' };

  const result = await db.$transaction(async (tx): Promise<{ ok: false; error: string } | { ok: true; id: string; already: boolean }> => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`event-seat:${row.id}`}))`;
    const existing = await tx.enrollment.findFirst({
      where: { organizationId, userId, productId: row.id, ...HOLDS_SEAT },
      select: { id: true },
    });
    if (existing) return { ok: true, id: existing.id, already: true };
    const taken = await tx.enrollment.count({ where: { organizationId, productId: row.id, ...HOLDS_SEAT } });
    const problem = registrationProblem({ ...factsOf(row), taken }, now);
    if (problem) return { ok: false, error: problem };
    const created = await tx.enrollment.create({
      data: {
        organizationId,
        branchId: branch.id,
        userId,
        productId: row.id,
        pricingPlanId: plan?.id,
        status: 'ENROLLED',
        source: 'SELF',
        startsAt: now,
      },
      select: { id: true },
    });
    return { ok: true, id: created.id, already: false };
  });

  if (!result.ok) return result;
  if (result.already) return { ok: true, message: 'You are already registered.' };

  await db.user.updateMany({ where: { id: userId, organizationId, kind: 'LEARNER' }, data: { status: 'ACTIVE' } });
  await happened({
    organizationId,
    key: 'enrolment.created',
    userId,
    subjectId: result.id,
    productId: row.id,
    data: { enrollmentId: result.id, item: row.title, source: 'SELF' },
  });
  const zone = await timeZoneOf(organizationId);
  await notifyLearner({
    organizationId,
    eventKey: 'event.registered',
    userId,
    subjectId: result.id,
    context: {
      item: row.title,
      when: eventWhen(row.event.startsAt, row.event.endsAt, zone),
      where: row.event.isOnline ? 'Online. The joining link appears on the event page shortly before it starts.' : (row.event.venue ?? ''),
      url: `/event/${row.slug}`,
    },
  });
  return { ok: true, message: 'You are registered.' };
}

/** Giving up a free place before the event starts, so somebody else can have it. */
export async function cancelFree(organizationId: string, userId: string, productId: string, now = new Date()): Promise<Outcome> {
  const row = await db.product.findFirst({
    where: { id: productId, organizationId, type: 'EVENT' },
    select: eventSelect,
  });
  if (!row?.event) return { ok: false, error: 'Event not found.' };
  if (eventPhase(factsOf(row), now) !== 'UPCOMING') return { ok: false, error: 'The event has started, so the place stays yours.' };

  const mine = await db.enrollment.findFirst({
    where: { organizationId, userId, productId: row.id, ...HOLDS_SEAT },
    select: { id: true, orderItemId: true, pricingPlan: { select: { pricePaise: true } } },
  });
  if (!mine) return { ok: false, error: 'You are not registered for this event.' };
  if ((mine.pricingPlan?.pricePaise ?? 0) > 0 || mine.orderItemId) {
    return { ok: false, error: 'A paid place is cancelled through the academy, so they can sort out the refund.' };
  }

  await db.enrollment.update({ where: { id: mine.id }, data: { status: 'CANCELLED' } });
  return { ok: true, message: 'Your place is given up. Thank you for letting someone else have it.' };
}

/** Everyone holding a place, for the office's list. */
export async function eventRegistrants(organizationId: string, productId: string) {
  return db.enrollment.findMany({
    where: { organizationId, productId, ...HOLDS_SEAT, product: { type: 'EVENT' } },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      createdAt: true,
      source: true,
      user: { select: { id: true, name: true, email: true, phone: true } },
      pricingPlan: { select: { pricePaise: true, currency: true } },
    },
  });
}
