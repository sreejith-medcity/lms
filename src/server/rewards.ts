'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { getSessionUser, requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import { canSeeLearner, staffScope } from '@/lib/scope';
import { claimVoucher, issueVoucher } from '@/lib/rewards';
import { ACHIEVEMENT_RULES } from '@/lib/reward-rules';
import type { ActionState } from '@/server/courses';

/**
 * Keeping stamp cards, achievements and vouchers.
 *
 * Reading needs the preferences permission, the same as points; writing
 * needs edit on it, since every one of these is a promise of money or a
 * discount. Issuing a voucher to a named learner is scoped like the rest of
 * the learner screens, so a branch office issues to its own learners.
 */

const PERMISSION = 'settings.preferences';

async function guard(action: 'view' | 'edit' | 'delete' = 'edit') {
  const [tenant, user] = await Promise.all([requireTenant(), requireStaff(PERMISSION, action)]);
  if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  console.error('[rewards]', message);
  return { error: 'Something went wrong. Please try again.' };
}

/** The last second of a calendar day on the academy's clock. */
function endOfDayIn(day: string, timeZone: string): Date {
  const guess = new Date(`${day}T23:59:59Z`);
  if (Number.isNaN(guess.getTime())) return guess;
  // The offset the zone has on that day, read back from the formatter, so DST zones land right.
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(guess);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const local = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return new Date(guess.getTime() - (local - guess.getTime()));
}

const optionalInt = (max: number) => z.coerce.number().int().min(0).max(max).optional().or(z.literal(''));

/* Stamp cards --------------------------------------------------------------- */

const schemeShape = z.object({
  id: z.string().optional().or(z.literal('')),
  name: z.string().trim().min(2, 'Give the card a name').max(80),
  stampsNeeded: z.coerce.number().int().min(1, 'At least one stamp').max(100),
  earn: z.enum(['CLASS_ATTENDED', 'LESSON_FINISHED', 'PURCHASE']),
  productId: z.string().optional().or(z.literal('')),
  reward: z.enum(['POINTS', 'VOUCHER']),
  rewardPoints: optionalInt(100000),
  voucherKind: z.enum(['PERCENT', 'FLAT']).optional().or(z.literal('')),
  voucherValue: optionalInt(10_000_000),
  voucherDays: optionalInt(3650),
  isActive: z.string().optional(),
});

async function courseHere(organizationId: string, productId: string): Promise<boolean> {
  const product = await db.product.findFirst({ where: { id: productId, organizationId, type: 'COURSE', deletedAt: null }, select: { id: true } });
  return Boolean(product);
}

function rewardFields(d: { reward?: 'POINTS' | 'VOUCHER'; rewardPoints?: number | ''; voucherKind?: 'PERCENT' | 'FLAT' | ''; voucherValue?: number | ''; voucherDays?: number | '' }): { rewardPoints: number; voucherKind: 'PERCENT' | 'FLAT' | null; voucherValue: number | null; voucherDays: number | null } | { error: string } {
  const points = d.reward === 'VOUCHER' ? 0 : Number(d.rewardPoints || 0);
  const wantsVoucher = d.reward === 'VOUCHER' || (d.reward === undefined && Boolean(d.voucherKind));
  if (!wantsVoucher) return { rewardPoints: points, voucherKind: null, voucherValue: null, voucherDays: null };
  const kind = d.voucherKind || '';
  const value = Number(d.voucherValue || 0);
  if (kind !== 'PERCENT' && kind !== 'FLAT') return { error: 'Say whether the voucher is a percentage or an amount.' };
  if (value <= 0) return { error: 'The voucher needs a value.' };
  if (kind === 'PERCENT' && value > 100) return { error: 'A percentage voucher cannot be over 100.' };
  return { rewardPoints: points, voucherKind: kind, voucherValue: kind === 'FLAT' ? value * 100 : value, voucherDays: d.voucherDays ? Number(d.voucherDays) : null };
}

export async function saveStampScheme(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('edit');
    const parsed = schemeShape.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;
    if (d.productId && !(await courseHere(tenant.organizationId, d.productId))) return { error: 'That course is not here.' };
    const reward = rewardFields(d);
    if ('error' in reward) return { error: reward.error };
    if (d.reward === 'POINTS' && reward.rewardPoints <= 0) return { error: 'How many points does a full card earn?' };
    const data = { name: d.name, stampsNeeded: d.stampsNeeded, earn: d.earn, productId: d.productId || null, reward: d.reward, ...reward, ...(d.isActive ? { isActive: d.isActive !== 'off' } : {}) };
    let id = d.id || '';
    if (id) {
      const have = await db.stampScheme.findFirst({ where: { id, organizationId: tenant.organizationId }, select: { id: true } });
      if (!have) return { error: 'Card not found.' };
      await db.stampScheme.update({ where: { id }, data });
    } else {
      id = (await db.stampScheme.create({ data: { organizationId: tenant.organizationId, ...data }, select: { id: true } })).id;
    }
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: d.id ? 'rewards.stamp_scheme_updated' : 'rewards.stamp_scheme_created', entity: 'StampScheme', entityId: id, after: data });
    revalidatePath('/admin/rewards');
    revalidatePath('/learn/rewards');
    return { ok: true, message: d.id ? 'Card saved.' : 'Card added. Learners start collecting from the next class, lesson or purchase.' };
  } catch (err) {
    return fail(err);
  }
}

export async function toggleStampScheme(id: string, isActive: boolean): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('edit');
    const r = await db.stampScheme.updateMany({ where: { id, organizationId: tenant.organizationId }, data: { isActive } });
    if (r.count === 0) return { error: 'Card not found.' };
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: isActive ? 'rewards.stamp_scheme_on' : 'rewards.stamp_scheme_off', entity: 'StampScheme', entityId: id });
    revalidatePath('/admin/rewards');
    revalidatePath('/learn/rewards');
    return { ok: true, message: isActive ? 'Collecting again.' : 'Paused. Stamps already on cards are kept.' };
  } catch (err) {
    return fail(err);
  }
}

/* Achievements -------------------------------------------------------------- */

const achievementShape = z.object({
  id: z.string().optional().or(z.literal('')),
  name: z.string().trim().min(2, 'Give the achievement a name').max(80),
  description: z.string().trim().max(300).optional().or(z.literal('')),
  rule: z.enum(['MODULE_FINISHED', 'COURSE_COMPLETED', 'PASSED_FIRST_ATTEMPT', 'FULL_MONTH_ATTENDANCE', 'STREAK_DAYS']),
  threshold: optionalInt(100000),
  productId: z.string().optional().or(z.literal('')),
  rewardPoints: optionalInt(100000),
  voucherKind: z.enum(['PERCENT', 'FLAT']).optional().or(z.literal('')),
  voucherValue: optionalInt(10_000_000),
  voucherDays: optionalInt(3650),
  isActive: z.string().optional(),
});

export async function saveAchievement(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('edit');
    const parsed = achievementShape.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;
    if (d.productId && !(await courseHere(tenant.organizationId, d.productId))) return { error: 'That course is not here.' };
    const def = ACHIEVEMENT_RULES.find((r) => r.rule === d.rule);
    const threshold = def?.thresholdLabel ? Number(d.threshold || 0) : 1;
    if (def?.thresholdLabel && threshold <= 0) return { error: `${def.thresholdLabel} is needed.` };
    if (d.rule === 'PASSED_FIRST_ATTEMPT' && threshold > 100) return { error: 'A score is a percentage, up to 100.' };
    const reward = rewardFields({ rewardPoints: d.rewardPoints, voucherKind: d.voucherKind, voucherValue: d.voucherValue, voucherDays: d.voucherDays });
    if ('error' in reward) return { error: reward.error };
    const data = { name: d.name, description: d.description || null, rule: d.rule, threshold, productId: d.productId || null, ...reward, ...(d.isActive ? { isActive: d.isActive !== 'off' } : {}) };
    let id = d.id || '';
    if (id) {
      const have = await db.achievement.findFirst({ where: { id, organizationId: tenant.organizationId }, select: { id: true } });
      if (!have) return { error: 'Achievement not found.' };
      await db.achievement.update({ where: { id }, data });
    } else {
      id = (await db.achievement.create({ data: { organizationId: tenant.organizationId, ...data }, select: { id: true } })).id;
    }
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: d.id ? 'rewards.achievement_updated' : 'rewards.achievement_created', entity: 'Achievement', entityId: id, after: data });
    revalidatePath('/admin/rewards');
    revalidatePath('/learn/rewards');
    return { ok: true, message: d.id ? 'Achievement saved.' : 'Achievement added. It is awarded from the next time it happens; nothing is awarded for the past.' };
  } catch (err) {
    return fail(err);
  }
}

export async function toggleAchievement(id: string, isActive: boolean): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('edit');
    const r = await db.achievement.updateMany({ where: { id, organizationId: tenant.organizationId }, data: { isActive } });
    if (r.count === 0) return { error: 'Achievement not found.' };
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: isActive ? 'rewards.achievement_on' : 'rewards.achievement_off', entity: 'Achievement', entityId: id });
    revalidatePath('/admin/rewards');
    revalidatePath('/learn/rewards');
    return { ok: true, message: isActive ? 'Awarding again.' : 'Paused. Awards already made are kept.' };
  } catch (err) {
    return fail(err);
  }
}

/* Vouchers ------------------------------------------------------------------ */

const voucherShape = z.object({
  /** One learner, or a printed batch of so many. */
  mode: z.enum(['learner', 'batch']),
  learner: z.string().trim().max(200).optional().or(z.literal('')),
  count: z.coerce.number().int().min(1).max(500).optional().or(z.literal('')),
  batchLabel: z.string().trim().max(80).optional().or(z.literal('')),
  kind: z.enum(['PERCENT', 'FLAT']),
  value: z.coerce.number().min(0.01, 'The voucher needs a value'),
  maxDiscountRupees: z.coerce.number().min(0).optional().or(z.literal('')),
  productId: z.string().optional().or(z.literal('')),
  expiresOn: z.string().optional().or(z.literal('')),
  note: z.string().trim().max(200).optional().or(z.literal('')),
});

export interface IssueState extends ActionState {
  codes?: string[];
  batchLabel?: string | null;
}

export async function issueVouchers(_prev: IssueState, formData: FormData): Promise<IssueState> {
  try {
    const { tenant, user } = await guard('edit');
    const parsed = voucherShape.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;
    if (d.kind === 'PERCENT' && d.value > 100) return { error: 'A percentage voucher cannot be over 100.' };
    if (d.productId && !(await courseHere(tenant.organizationId, d.productId))) return { error: 'That course is not here.' };
    const expiresAt = d.expiresOn ? endOfDayIn(d.expiresOn, tenant.timezone) : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) return { error: 'That expiry date is not a date.' };
    if (expiresAt && expiresAt < new Date()) return { error: 'The expiry is in the past.' };
    const common = {
      organizationId: tenant.organizationId,
      kind: d.kind,
      value: d.kind === 'FLAT' ? Math.round(d.value * 100) : Math.round(d.value),
      maxDiscountPaise: d.kind === 'PERCENT' && d.maxDiscountRupees ? Math.round(Number(d.maxDiscountRupees) * 100) : null,
      productId: d.productId || null,
      expiresAt,
      note: d.note || null,
      issuedById: user.id,
    };

    if (d.mode === 'learner') {
      const scope = await staffScope(user);
      const q = (d.learner || '').trim();
      if (!q) return { error: 'Say who the voucher is for.' };
      const learner = await db.user.findFirst({
        where: {
          organizationId: tenant.organizationId,
          kind: 'LEARNER',
          deletedAt: null,
          OR: [{ email: q.toLowerCase() }, { phone: q.replace(/\D/g, '').slice(-10) || q }, ...(/^\d+$/.test(q) ? [{ registrationNo: Number(q) }] : [])],
        },
        select: { id: true, name: true },
      });
      if (!learner) return { error: 'No learner has that email, mobile or registration number.' };
      if (!(await canSeeLearner(scope, tenant.organizationId, learner.id))) return { error: 'That learner is outside your branch.' };
      const v = await issueVoucher({ ...common, userId: learner.id, source: 'ADMIN' });
      await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'rewards.voucher_issued', entity: 'Voucher', entityId: v.id, after: { code: v.code, userId: learner.id, kind: d.kind, value: common.value } });
      revalidatePath('/admin/rewards');
      revalidatePath('/learn/rewards');
      return { ok: true, message: `Voucher ${v.code} issued to ${learner.name}. It is on their Rewards page.`, codes: [v.code] };
    }

    const count = Number(d.count || 0);
    if (count < 1) return { error: 'How many vouchers to print?' };
    const batchLabel = d.batchLabel || `Batch ${new Date().toISOString().slice(0, 10)}`;
    const codes: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const v = await issueVoucher({ ...common, userId: null, source: 'BATCH', batchLabel });
      codes.push(v.code);
    }
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'rewards.voucher_batch', entity: 'Voucher', entityId: batchLabel, after: { count, kind: d.kind, value: common.value } });
    revalidatePath('/admin/rewards');
    return { ok: true, message: `${count} vouchers printed under "${batchLabel}". Each is claimed by whoever scans or types it first.`, codes, batchLabel };
  } catch (err) {
    return fail(err);
  }
}

export async function cancelVoucher(id: string): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('edit');
    const scope = await staffScope(user);
    const held = await db.voucher.findFirst({ where: { id, organizationId: tenant.organizationId }, select: { userId: true } });
    if (held?.userId && !(await canSeeLearner(scope, tenant.organizationId, held.userId))) return { error: 'That voucher belongs to a learner outside your branch.' };
    const r = await db.voucher.updateMany({ where: { id, organizationId: tenant.organizationId, status: 'ISSUED' }, data: { status: 'CANCELLED' } });
    if (r.count === 0) return { error: 'That voucher is not live, so there is nothing to cancel.' };
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'rewards.voucher_cancelled', entity: 'Voucher', entityId: id });
    revalidatePath('/admin/rewards');
    revalidatePath('/learn/rewards');
    return { ok: true, message: 'Cancelled.' };
  } catch (err) {
    return fail(err);
  }
}

/** A learner typing or scanning a printed voucher: it becomes theirs. */
export async function claimMyVoucher(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const [tenant, user] = await Promise.all([requireTenant(), getSessionUser()]);
    if (!user || user.organizationId !== tenant.organizationId) return { error: 'Please sign in again.' };
    if (user.kind !== 'LEARNER') return { error: 'Vouchers are claimed from a learner account.' };
    const code = String(formData.get('code') ?? '');
    const r = await claimVoucher(tenant.organizationId, user.id, code);
    if (!r.ok) return { error: r.error };
    revalidatePath('/learn/rewards');
    return { ok: true, message: `${r.code} is yours: ${r.worth}. Type it in the code box at checkout.` };
  } catch (err) {
    return fail(err);
  }
}
