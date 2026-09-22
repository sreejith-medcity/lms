import { randomInt } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { queueNotifications } from '@/lib/notify';
import { mayAwardInternally } from '@/lib/loyalty-provider';
import { loyaltyConfig } from '@/lib/wallet';
import { dayKey } from '@/lib/clock';
import {
  describeVoucher,
  fullMonth,
  normaliseVoucherCode,
  ruleMet,
  stampOutcome,
  voucherCodeFrom,
  voucherDiscount,
  voucherRefusal,
  voucherRefusalMessage,
  type AchievementRule,
  type VoucherRefusal,
} from '@/lib/reward-rules';

/**
 * Stamp cards, vouchers and achievements: the part that touches the
 * database. The rules are in `reward-rules.ts`.
 *
 * Everything here is called from the side of something that already
 * happened (a register saved, a lesson finished, a payment landed) and
 * must never break that thing, so every entry point catches its own
 * errors and logs them. A reward that fails to issue is a support ticket;
 * a register that fails to save because of a reward is an incident.
 */

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof db;

const EVENT = 'reward.earned';

/* Vouchers ------------------------------------------------------------------ */

export interface IssueVoucherInput {
  organizationId: string;
  userId?: string | null;
  kind: 'PERCENT' | 'FLAT';
  /** Percent for PERCENT, paise for FLAT. */
  value: number;
  maxDiscountPaise?: number | null;
  productId?: string | null;
  expiresAt?: Date | null;
  source?: 'ADMIN' | 'BATCH' | 'STAMP_CARD' | 'ACHIEVEMENT';
  batchLabel?: string | null;
  note?: string | null;
  issuedById?: string | null;
  prefix?: string;
}

/** A voucher with a code nobody else in this academy has. */
export async function issueVoucher(input: IssueVoucherInput, client: Db = db): Promise<{ id: string; code: string }> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = voucherCodeFrom((n) => randomInt(n), input.prefix ?? 'V');
    const taken = await client.voucher.findUnique({ where: { organizationId_code: { organizationId: input.organizationId, code } }, select: { id: true } });
    if (taken) continue;
    const created = await client.voucher.create({
      data: {
        organizationId: input.organizationId,
        code,
        kind: input.kind,
        value: Math.max(0, Math.round(input.value)),
        maxDiscountPaise: input.maxDiscountPaise ?? null,
        productId: input.productId ?? null,
        userId: input.userId ?? null,
        source: input.source ?? 'ADMIN',
        batchLabel: input.batchLabel ?? null,
        expiresAt: input.expiresAt ?? null,
        claimedAt: input.userId ? new Date() : null,
        note: input.note ?? null,
        issuedById: input.issuedById ?? null,
      },
      select: { id: true, code: true },
    });
    return created;
  }
  throw new Error('Could not find a free voucher code.');
}

export class VoucherRefused extends Error {
  constructor(public reason: VoucherRefusal) {
    super(voucherRefusalMessage(reason));
  }
}

export interface VoucherClaim {
  voucherId: string;
  code: string;
  discountPaise: number;
}

/**
 * A voucher quoted for an order, inside the order's transaction: found by
 * code, checked for this person and course, and its worth on this subtotal.
 * Nothing is written; `redeemVoucher` spends it once the order exists.
 */
export async function quoteVoucher(tx: Db, input: { organizationId: string; rawCode: string; userId: string; productId: string | null; subtotalPaise: number }): Promise<VoucherClaim> {
  const code = normaliseVoucherCode(input.rawCode);
  const v = await tx.voucher.findUnique({
    where: { organizationId_code: { organizationId: input.organizationId, code } },
    select: { id: true, code: true, kind: true, value: true, maxDiscountPaise: true, status: true, expiresAt: true, userId: true, productId: true },
  });
  if (!v) throw new VoucherRefused('NOT_FOUND');
  const why = voucherRefusal(v, { userId: input.userId, productId: input.productId });
  if (why) throw new VoucherRefused(why);
  const discountPaise = voucherDiscount(v, input.subtotalPaise);
  if (discountPaise <= 0) throw new VoucherRefused('NOTHING_OFF');
  return { voucherId: v.id, code: v.code, discountPaise };
}

/**
 * Spent: one conditional update, so two orders racing for the same voucher
 * cannot both take it. A printed voucher nobody had claimed is claimed by
 * the person spending it.
 */
export async function redeemVoucher(tx: Db, input: { organizationId: string; voucherId: string; userId: string; orderId: string }): Promise<void> {
  const now = new Date();
  const done = await tx.voucher.updateMany({
    where: { id: input.voucherId, organizationId: input.organizationId, status: 'ISSUED', OR: [{ userId: input.userId }, { userId: null }], AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] }] },
    data: { status: 'REDEEMED', redeemedAt: now, orderId: input.orderId, userId: input.userId, claimedAt: now },
  });
  if (done.count === 1) return;
  // Say why, since between the quote and this line the voucher can have been spent, cancelled or run out.
  const v = await tx.voucher.findFirst({ where: { id: input.voucherId, organizationId: input.organizationId }, select: { status: true, expiresAt: true, userId: true, productId: true } });
  throw new VoucherRefused((v && voucherRefusal(v, { userId: input.userId, productId: null, now })) || 'REDEEMED');
}

/**
 * A voucher on an order that was started and never paid (the gateway
 * window closed, the learner walked away) is theirs again after a day,
 * rather than "already spent" until somebody in the office notices.
 */
export async function releaseAbandonedVouchers(organizationId: string, now = new Date()): Promise<number> {
  const stale = new Date(now.getTime() - 24 * 3_600_000);
  const rows = await db.voucher.findMany({
    where: { organizationId, status: 'REDEEMED', order: { status: 'PENDING', placedAt: { lt: stale } } },
    select: { id: true },
  });
  if (rows.length === 0) return 0;
  const r = await db.voucher.updateMany({ where: { organizationId, id: { in: rows.map((x) => x.id) }, status: 'REDEEMED' }, data: { status: 'ISSUED', redeemedAt: null, orderId: null } });
  return r.count;
}

/** A payment that never landed gives the voucher back. */
export async function releaseVoucher(organizationId: string, orderId: string): Promise<number> {
  const r = await db.voucher.updateMany({ where: { organizationId, orderId, status: 'REDEEMED' }, data: { status: 'ISSUED', redeemedAt: null, orderId: null } });
  return r.count;
}

/** A printed voucher scanned by a learner becomes theirs; their own scanned again is simply confirmed. */
export async function claimVoucher(organizationId: string, userId: string, rawCode: string): Promise<{ ok: true; code: string; worth: string; expiresAt: Date | null } | { ok: false; error: string }> {
  const code = normaliseVoucherCode(rawCode);
  if (!code) return { ok: false, error: 'Type the code on the voucher.' };
  const v = await db.voucher.findUnique({
    where: { organizationId_code: { organizationId, code } },
    select: { id: true, code: true, kind: true, value: true, maxDiscountPaise: true, status: true, expiresAt: true, userId: true, productId: true },
  });
  if (!v) return { ok: false, error: voucherRefusalMessage('NOT_FOUND') };
  const why = voucherRefusal(v, { userId, productId: null });
  if (why) return { ok: false, error: voucherRefusalMessage(why) };
  if (!v.userId) {
    const took = await db.voucher.updateMany({ where: { id: v.id, userId: null, status: 'ISSUED' }, data: { userId, claimedAt: new Date() } });
    if (took.count !== 1) return { ok: false, error: voucherRefusalMessage('NOT_YOURS') };
  }
  return { ok: true, code: v.code, worth: describeVoucher(v), expiresAt: v.expiresAt };
}

export interface VoucherSummary {
  id: string;
  code: string;
  worth: string;
  productId: string | null;
  product: string | null;
  status: string;
  expiresAt: Date | null;
  redeemedAt: Date | null;
  source: string;
}

export async function vouchersFor(organizationId: string, userId: string): Promise<VoucherSummary[]> {
  const rows = await db.voucher.findMany({
    where: { organizationId, userId },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: 100,
    select: { id: true, code: true, kind: true, value: true, maxDiscountPaise: true, productId: true, status: true, expiresAt: true, redeemedAt: true, source: true },
  });
  const productIds = [...new Set(rows.map((r) => r.productId).filter((x): x is string => Boolean(x)))];
  const titles = new Map(
    (productIds.length ? await db.product.findMany({ where: { organizationId, id: { in: productIds } }, select: { id: true, title: true } }) : []).map((p) => [p.id, p.title]),
  );
  const now = new Date();
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    worth: describeVoucher(r),
    productId: r.productId,
    product: r.productId ? (titles.get(r.productId) ?? null) : null,
    status: r.status === 'ISSUED' && r.expiresAt && r.expiresAt < now ? 'EXPIRED' : r.status,
    expiresAt: r.expiresAt,
    redeemedAt: r.redeemedAt,
    source: r.source,
  }));
}

/** The night job: vouchers past their date are marked so the lists stop showing them as live. */
export async function expireVouchers(organizationId: string, now = new Date()): Promise<number> {
  const r = await db.voucher.updateMany({ where: { organizationId, status: 'ISSUED', expiresAt: { lt: now } }, data: { status: 'EXPIRED' } });
  return r.count;
}

/* Paying out ---------------------------------------------------------------- */

interface Payout {
  rewardPoints: number;
  voucherKind: 'PERCENT' | 'FLAT' | null;
  voucherValue: number | null;
  voucherDays: number | null;
  productId: string | null;
}

/** What a full card or an achievement gives: points into the wallet, a voucher, or both. Returns the words for the notification. */
async function payOut(organizationId: string, userId: string, reward: Payout, source: 'STAMP_CARD' | 'ACHIEVEMENT', note: string): Promise<string[]> {
  const got: string[] = [];
  if (reward.rewardPoints > 0 && (await mayAwardInternally(organizationId))) {
    const { credit } = await import('@/lib/wallet');
    const config = await loyaltyConfig(organizationId);
    const r = await credit({ userId, points: reward.rewardPoints, reason: source, note, maxBalance: config.maxCreditAllowed }).catch(() => null);
    if (r && r.applied > 0) got.push(`${r.applied} points`);
  }
  if (reward.voucherKind && reward.voucherValue && reward.voucherValue > 0) {
    const expiresAt = reward.voucherDays ? new Date(Date.now() + reward.voucherDays * 86_400_000) : null;
    const v = await issueVoucher({ organizationId, userId, kind: reward.voucherKind, value: reward.voucherValue, productId: reward.productId, expiresAt, source, note });
    got.push(`a voucher, ${describeVoucher({ kind: reward.voucherKind, value: reward.voucherValue, maxDiscountPaise: null })} (${v.code})`);
  }
  return got;
}

async function tell(organizationId: string, userId: string, dedupeKey: string, what: string, got: string[], url: string): Promise<void> {
  const [person, tenant] = await Promise.all([
    db.user.findFirst({ where: { id: userId, organizationId }, select: { id: true, name: true, email: true, phone: true } }),
    db.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
  ]);
  if (!person) return;
  await queueNotifications({
    organizationId,
    eventKey: EVENT,
    channels: ['IN_APP', 'PUSH'],
    recipients: [{ userId: person.id, email: person.email, phone: person.phone }],
    dedupeKey,
    context: { name: person.name, what, got: got.length ? got.join(' and ') : 'our thanks', organization: tenant?.name ?? '', url },
  }).catch(() => null);
}

/* Stamp cards --------------------------------------------------------------- */

export type StampEarn = 'CLASS_ATTENDED' | 'LESSON_FINISHED' | 'PURCHASE';

/**
 * One stamp on every active card of this kind the learner qualifies for,
 * keyed on the thing that earned it so it can never stamp twice. A full
 * card pays out and starts again.
 */
export async function stampFor(input: { organizationId: string; userId: string; earn: StampEarn; sourceKey: string; productId?: string | null }): Promise<number> {
  try {
    const schemes = await db.stampScheme.findMany({
      where: { organizationId: input.organizationId, isActive: true, earn: input.earn, OR: [{ productId: null }, ...(input.productId ? [{ productId: input.productId }] : [])] },
      select: { id: true, name: true, stampsNeeded: true, reward: true, rewardPoints: true, voucherKind: true, voucherValue: true, voucherDays: true, productId: true },
    });
    if (schemes.length === 0) return 0;
    let filled = 0;
    for (const scheme of schemes) {
      const card = await db.stampCard.upsert({
        where: { schemeId_userId: { schemeId: scheme.id, userId: input.userId } },
        create: { organizationId: input.organizationId, userId: input.userId, schemeId: scheme.id },
        update: {},
        select: { id: true, stamps: true, cardsFilled: true },
      });
      // The stamp row and the count move together, and the count is an
      // increment rather than a value read a moment ago, so two marks landing
      // at once (a register and a class platform's webhook, say) cannot lose
      // a stamp or fill the card twice.
      const after = await db.$transaction(async (tx) => {
        const stamped = await tx.stamp.createMany({ data: [{ cardId: card.id, sourceKey: input.sourceKey }], skipDuplicates: true });
        if (stamped.count === 0) return null;
        return tx.stampCard.update({ where: { id: card.id }, data: { stamps: { increment: 1 }, lastStampAt: new Date() }, select: { stamps: true } });
      });
      if (!after) continue;
      if (!stampOutcome(after.stamps - 1, scheme.stampsNeeded).full) continue;
      // Full: take the card's worth of stamps off and count the card, once,
      // whichever of two racing marks gets here first.
      const turned = await db.stampCard.updateMany({ where: { id: card.id, stamps: { gte: scheme.stampsNeeded } }, data: { stamps: { decrement: scheme.stampsNeeded }, cardsFilled: { increment: 1 } } });
      if (turned.count !== 1) continue;
      filled += 1;
      const got = await payOut(
        input.organizationId,
        input.userId,
        { rewardPoints: scheme.reward === 'POINTS' ? scheme.rewardPoints : 0, voucherKind: scheme.reward === 'VOUCHER' ? scheme.voucherKind : null, voucherValue: scheme.voucherValue, voucherDays: scheme.voucherDays, productId: scheme.productId },
        'STAMP_CARD',
        `${scheme.name}: card ${card.cardsFilled + 1} full`,
      );
      await tell(input.organizationId, input.userId, `stamp:${scheme.id}:${card.cardsFilled + 1}`, `Your ${scheme.name} card is full`, got, '/learn/rewards');
    }
    return filled;
  } catch (err) {
    console.error('[rewards] stamp', err instanceof Error ? err.message : err);
    return 0;
  }
}

export interface StampCardSummary {
  schemeId: string;
  name: string;
  stamps: number;
  stampsNeeded: number;
  cardsFilled: number;
  reward: string;
  product: string | null;
  earn: StampEarn;
}

export async function stampCardsFor(organizationId: string, userId: string): Promise<StampCardSummary[]> {
  const schemes = await db.stampScheme.findMany({
    where: { organizationId, isActive: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, stampsNeeded: true, reward: true, rewardPoints: true, voucherKind: true, voucherValue: true, productId: true, earn: true, cards: { where: { userId }, select: { stamps: true, cardsFilled: true } } },
  });
  const productIds = [...new Set(schemes.map((s) => s.productId).filter((x): x is string => Boolean(x)))];
  const titles = new Map(
    (productIds.length ? await db.product.findMany({ where: { organizationId, id: { in: productIds } }, select: { id: true, title: true } }) : []).map((p) => [p.id, p.title]),
  );
  return schemes.map((s) => ({
    schemeId: s.id,
    name: s.name,
    stamps: s.cards[0]?.stamps ?? 0,
    stampsNeeded: s.stampsNeeded,
    cardsFilled: s.cards[0]?.cardsFilled ?? 0,
    reward: rewardWords(s),
    product: s.productId ? (titles.get(s.productId) ?? null) : null,
    earn: s.earn,
  }));
}

export function rewardWords(s: { reward?: string; rewardPoints: number; voucherKind: string | null; voucherValue: number | null }): string {
  const parts: string[] = [];
  if ((s.reward === undefined || s.reward === 'POINTS') && s.rewardPoints > 0) parts.push(`${s.rewardPoints} points`);
  if ((s.reward === undefined || s.reward === 'VOUCHER') && s.voucherKind && s.voucherValue) parts.push(`a voucher for ${describeVoucher({ kind: s.voucherKind, value: s.voucherValue, maxDiscountPaise: null })}`);
  return parts.length ? parts.join(' and ') : 'the academy’s thanks';
}

/* Achievements -------------------------------------------------------------- */

/**
 * Something happened that an achievement might be for. Every active
 * achievement on that rule (and course, when it names one) is checked
 * against the value and awarded once per context.
 */
export async function achievementEvent(input: { organizationId: string; userId: string; rule: AchievementRule; contextKey: string; context: string; value?: number; productId?: string | null }): Promise<number> {
  try {
    const defs = await db.achievement.findMany({
      where: { organizationId: input.organizationId, isActive: true, rule: input.rule, OR: [{ productId: null }, ...(input.productId ? [{ productId: input.productId }] : [])] },
      select: { id: true, name: true, threshold: true, rewardPoints: true, voucherKind: true, voucherValue: true, voucherDays: true, productId: true },
    });
    let awarded = 0;
    for (const def of defs) {
      if (!ruleMet(input.rule, def.threshold, input.value ?? 0)) continue;
      const contextKey = input.rule === 'STREAK_DAYS' ? `streak:${def.threshold}` : input.contextKey;
      const made = await db.achievementAward.createMany({ data: [{ achievementId: def.id, userId: input.userId, contextKey, context: input.context.slice(0, 200) }], skipDuplicates: true });
      if (made.count === 0) continue;
      awarded += 1;
      try {
        const got = await payOut(input.organizationId, input.userId, def, 'ACHIEVEMENT', `${def.name}: ${input.context}`.slice(0, 200));
        await tell(input.organizationId, input.userId, `achievement:${def.id}:${contextKey}`, def.name, got, '/learn/rewards');
      } catch (err) {
        // The award stands; what it should have paid is in the log for the office.
        console.error('[rewards] achievement payout', def.id, input.userId, err instanceof Error ? err.message : err);
      }
    }
    return awarded;
  } catch (err) {
    console.error('[rewards] achievement', err instanceof Error ? err.message : err);
    return 0;
  }
}

/** A lesson was finished: stamps, and the module it belongs to if that was its last lesson. */
export async function lessonFinished(organizationId: string, userId: string, materialId: string): Promise<void> {
  try {
    const material = await db.material.findFirst({
      where: { id: materialId, section: { module: { organizationId } } },
      select: { id: true, sectionId: true, section: { select: { moduleId: true, module: { select: { name: true, courses: { select: { course: { select: { productId: true } } } } } } } } },
    });
    if (!material) return;
    // A module can sit in several courses; the one that counts is the one the learner is on.
    const candidates = material.section.module.courses.map((c) => c.course.productId);
    const enrolled = candidates.length > 1 ? await db.enrollment.findFirst({ where: { organizationId, userId, productId: { in: candidates } }, orderBy: { createdAt: 'desc' }, select: { productId: true } }) : null;
    const productId = enrolled?.productId ?? candidates[0] ?? null;
    await stampFor({ organizationId, userId, earn: 'LESSON_FINISHED', sourceKey: `material:${materialId}`, productId });

    const moduleId = material.section.moduleId;
    const [lessons, done] = await Promise.all([
      db.material.findMany({ where: { section: { moduleId } }, select: { id: true } }),
      db.materialProgress.findMany({ where: { userId, completedAt: { not: null }, material: { section: { moduleId } } }, select: { materialId: true } }),
    ]);
    const finished = new Set(done.map((d) => d.materialId));
    if (lessons.length > 0 && lessons.every((l) => finished.has(l.id))) {
      await achievementEvent({ organizationId, userId, rule: 'MODULE_FINISHED', contextKey: `module:${moduleId}`, context: material.section.module.name, productId });
    }
  } catch (err) {
    console.error('[rewards] lesson', err instanceof Error ? err.message : err);
  }
}

/** A class was attended: a stamp, and the month if this was the last class of it. */
export async function classAttended(organizationId: string, userId: string, sessionId: string): Promise<void> {
  try {
    const session = await db.liveSession.findFirst({
      where: { id: sessionId, organizationId },
      select: { id: true, startsAt: true, batchId: true, batch: { select: { name: true, course: { select: { productId: true } } } } },
    });
    if (!session) return;
    const productId = session.batch?.course.productId ?? null;
    await stampFor({ organizationId, userId, earn: 'CLASS_ATTENDED', sourceKey: `session:${sessionId}`, productId });
    if (!session.batchId) return;

    const tenant = await db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
    const month = dayKey(session.startsAt, tenant?.timezone ?? 'Asia/Kolkata').slice(0, 7);
    // Every class of that batch in the same calendar month, on the academy's clock.
    const from = new Date(session.startsAt.getTime() - 32 * 86_400_000);
    const to = new Date(session.startsAt.getTime() + 32 * 86_400_000);
    const classes = await db.liveSession.findMany({
      where: { organizationId, batchId: session.batchId, isHoliday: false, status: { in: ['SCHEDULED', 'LIVE', 'COMPLETED'] }, startsAt: { gte: from, lte: to } },
      select: { id: true, status: true, startsAt: true, endsAt: true, attendances: { where: { userId }, select: { status: true } } },
    });
    const inMonth = classes.filter((c) => dayKey(c.startsAt, tenant?.timezone ?? 'Asia/Kolkata').slice(0, 7) === month);
    // The class being marked is over as far as the month is concerned (the register is taken during it), and so is any class already completed.
    const shape = inMonth.map((c) => ({ endsAt: c.id === sessionId || c.status === 'COMPLETED' ? new Date(0) : c.endsAt, attended: c.attendances.some((a) => a.status === 'PRESENT' || a.status === 'LATE') }));
    const defs = await db.achievement.findMany({ where: { organizationId, isActive: true, rule: 'FULL_MONTH_ATTENDANCE' }, select: { threshold: true } });
    for (const threshold of new Set(defs.map((d) => d.threshold))) {
      if (!fullMonth(shape, threshold)) continue;
      await achievementEvent({ organizationId, userId, rule: 'FULL_MONTH_ATTENDANCE', contextKey: `batch:${session.batchId}:${month}`, context: `${session.batch?.name ?? 'the batch'}, ${month}`, value: inMonth.length, productId });
    }
  } catch (err) {
    console.error('[rewards] class', err instanceof Error ? err.message : err);
  }
}

/** A payment landed: a stamp per course bought. */
export async function purchaseMade(organizationId: string, userId: string, orderId: string): Promise<void> {
  try {
    const items = await db.orderItem.findMany({ where: { orderId, order: { organizationId } }, select: { productId: true } });
    for (const item of items) {
      if (!item.productId) continue;
      await stampFor({ organizationId, userId, earn: 'PURCHASE', sourceKey: `order:${orderId}:${item.productId}`, productId: item.productId });
    }
  } catch (err) {
    console.error('[rewards] purchase', err instanceof Error ? err.message : err);
  }
}

export interface AchievementSummary {
  id: string;
  name: string;
  description: string | null;
  rule: string;
  threshold: number;
  reward: string;
  product: string | null;
  awards: { context: string | null; awardedAt: Date }[];
}

export async function achievementsFor(organizationId: string, userId: string): Promise<AchievementSummary[]> {
  const defs = await db.achievement.findMany({
    where: { organizationId, isActive: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, description: true, rule: true, threshold: true, rewardPoints: true, voucherKind: true, voucherValue: true, productId: true, awards: { where: { userId }, orderBy: { awardedAt: 'desc' }, select: { context: true, awardedAt: true } } },
  });
  const productIds = [...new Set(defs.map((s) => s.productId).filter((x): x is string => Boolean(x)))];
  const titles = new Map(
    (productIds.length ? await db.product.findMany({ where: { organizationId, id: { in: productIds } }, select: { id: true, title: true } }) : []).map((p) => [p.id, p.title]),
  );
  return defs.map((d) => ({
    id: d.id,
    name: d.name,
    description: d.description,
    rule: d.rule,
    threshold: d.threshold,
    reward: rewardWords({ rewardPoints: d.rewardPoints, voucherKind: d.voucherKind, voucherValue: d.voucherValue }),
    product: d.productId ? (titles.get(d.productId) ?? null) : null,
    awards: d.awards,
  }));
}

/**
 * The month just gone, looked at again: a month can end with a class
 * cancelled after the last one attended, or a mark corrected later, and
 * then no mark ever re-checks it. Runs from the hourly job in the first
 * days of a month; awarding is idempotent, so running it twice is safe.
 */
export async function reviewLastMonthAttendance(organizationId: string, now = new Date()): Promise<number> {
  try {
    const defs = await db.achievement.findMany({ where: { organizationId, isActive: true, rule: 'FULL_MONTH_ATTENDANCE' }, select: { threshold: true } });
    if (defs.length === 0) return 0;
    const tenant = await db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
    const tz = tenant?.timezone ?? 'Asia/Kolkata';
    const today = dayKey(now, tz);
    if (Number(today.slice(8, 10)) > 3) return 0;
    const [y, m] = today.slice(0, 7).split('-').map(Number);
    const month = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}`;
    // A window a little wider than the month in UTC, then filtered on the academy's clock.
    const from = new Date(Date.UTC(m === 1 ? y - 1 : y, m === 1 ? 11 : m - 2, 1) - 2 * 86_400_000);
    const to = new Date(Date.UTC(y, m - 1, 1) + 2 * 86_400_000);
    const sessions = await db.liveSession.findMany({
      where: { organizationId, batchId: { not: null }, isHoliday: false, status: 'COMPLETED', startsAt: { gte: from, lt: to } },
      select: { id: true, batchId: true, startsAt: true, endsAt: true, batch: { select: { name: true, course: { select: { productId: true } } } }, attendances: { select: { userId: true, status: true } } },
    });
    const byBatch = new Map<string, typeof sessions>();
    for (const s of sessions) {
      if (dayKey(s.startsAt, tz).slice(0, 7) !== month) continue;
      const list = byBatch.get(s.batchId as string) ?? [];
      list.push(s);
      byBatch.set(s.batchId as string, list);
    }
    let awarded = 0;
    for (const [batchId, classes] of byBatch) {
      const learners = new Set(classes.flatMap((c) => c.attendances.map((a) => a.userId)));
      for (const userId of learners) {
        const shape = classes.map((c) => ({ endsAt: new Date(0), attended: c.attendances.some((a) => a.userId === userId && (a.status === 'PRESENT' || a.status === 'LATE')) }));
        for (const threshold of new Set(defs.map((d) => d.threshold))) {
          if (!fullMonth(shape, threshold, now)) continue;
          awarded += await achievementEvent({ organizationId, userId, rule: 'FULL_MONTH_ATTENDANCE', contextKey: `batch:${batchId}:${month}`, context: `${classes[0].batch?.name ?? 'the batch'}, ${month}`, value: classes.length, productId: classes[0].batch?.course.productId ?? null });
        }
      }
    }
    return awarded;
  } catch (err) {
    console.error('[rewards] month review', err instanceof Error ? err.message : err);
    return 0;
  }
}
