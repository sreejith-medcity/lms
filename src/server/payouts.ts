'use server';

import { revalidatePath } from 'next/cache';
import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import { adjustmentProblem, computePayout, monthWindow } from '@/lib/payouts';
import { classesTaken } from '@/lib/teaching-data';
import type { ActionState } from '@/server/courses';

/**
 * Payouts from the office. Drawn up for a month from the classes taken,
 * adjusted with a reason, approved, then marked paid with the reference.
 * The figures are copied in when drawn up; redrawing a draft reads the
 * calendar again, which is the only way a figure changes without a note.
 */

const PERMISSION = 'instructor.instructor_management';
const PAGE = '/admin/payouts';

async function guard(action: 'view' | 'edit' | 'delete' = 'edit') {
  const [tenant, user] = await Promise.all([requireTenant(), requireStaff(PERMISSION, action)]);
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  console.error('[payouts]', message);
  return { error: 'Something went wrong. Please try again.' };
}

/** Draw up (or redraw the drafts of) every instructor's payout for a month. */
export async function drawUpPayouts(monthKey: string): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();
    const window = monthWindow(monthKey, tenant.timezone);
    if (!window) return { error: 'Pick a month.' };
    if (window.from.getTime() > Date.now()) return { error: 'That month has not started.' };

    const taken = await classesTaken(tenant.organizationId, window.from, window.to);
    const userIds = Array.from(taken.keys());
    if (userIds.length === 0) return { error: `No completed classes in ${window.label}.` };

    const people = await db.user.findMany({
      where: { organizationId: tenant.organizationId, id: { in: userIds } },
      select: { id: true, instructorProfile: { select: { hourlyRatePaise: true, perSessionPaise: true } } },
    });
    const existing = await db.instructorPayout.findMany({
      where: { organizationId: tenant.organizationId, periodFrom: window.from },
      select: { id: true, userId: true, status: true, adjustmentPaise: true },
    });
    const byUser = new Map(existing.map((e) => [e.userId, e]));

    let drawn = 0;
    let kept = 0;
    for (const p of people) {
      const lines = taken.get(p.id) ?? [];
      const maths = computePayout(lines, { hourlyRatePaise: p.instructorProfile?.hourlyRatePaise ?? null, perSessionPaise: p.instructorProfile?.perSessionPaise ?? null });
      const prior = byUser.get(p.id);
      if (prior && prior.status !== 'DRAFT') {
        kept += 1;
        continue;
      }
      const adjustment = prior?.adjustmentPaise ?? 0;
      const data = {
        sessions: maths.sessions,
        minutes: maths.minutes,
        ratePaise: maths.ratePaise,
        rateBasis: maths.rateBasis,
        earnedPaise: maths.earnedPaise,
        totalPaise: maths.earnedPaise + adjustment,
        lines: lines as unknown as Prisma.InputJsonValue,
      };
      if (prior) {
        await db.instructorPayout.update({ where: { id: prior.id }, data });
      } else {
        await db.instructorPayout.create({ data: { organizationId: tenant.organizationId, userId: p.id, periodFrom: window.from, periodTo: window.to, createdById: user.id, ...data } });
      }
      drawn += 1;
    }
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'payout.draw_up', entity: 'InstructorPayout', entityId: monthKey, after: { drawn, kept } });
    revalidatePath(PAGE);
    return { ok: true, message: `${drawn} drawn up for ${window.label}${kept ? `; ${kept} already approved or paid, left as they are` : ''}.` };
  } catch (err) {
    return fail(err);
  }
}

async function payoutRow(id: string, organizationId: string) {
  return db.instructorPayout.findFirst({ where: { id, organizationId }, select: { id: true, status: true, earnedPaise: true, adjustmentPaise: true, userId: true } });
}

export async function setPayoutAdjustment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();
    const id = String(formData.get('id') ?? '');
    const paise = Math.round(Number(formData.get('adjustmentRupees') ?? 0) * 100);
    const note = String(formData.get('adjustmentNote') ?? '').trim();
    const problem = adjustmentProblem(paise, note);
    if (problem) return { error: problem };
    const row = await payoutRow(id, tenant.organizationId);
    if (!row) return { error: 'Payout not found.' };
    if (row.status === 'PAID') return { error: 'This payout is paid; it cannot be changed.' };
    await db.instructorPayout.update({ where: { id: row.id }, data: { adjustmentPaise: paise, adjustmentNote: note || null, totalPaise: row.earnedPaise + paise } });
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'payout.adjust', entity: 'InstructorPayout', entityId: id, after: { paise, note } });
    revalidatePath(PAGE);
    revalidatePath(`${PAGE}/${id}`);
    return { ok: true, message: 'Adjustment saved.' };
  } catch (err) {
    return fail(err);
  }
}

export async function approvePayout(id: string): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();
    const row = await payoutRow(id, tenant.organizationId);
    if (!row) return { error: 'Payout not found.' };
    if (row.status !== 'DRAFT') return { error: 'Already approved.' };
    await db.instructorPayout.update({ where: { id: row.id }, data: { status: 'APPROVED', approvedAt: new Date(), approvedById: user.id } });
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'payout.approve', entity: 'InstructorPayout', entityId: id });
    revalidatePath(PAGE);
    revalidatePath(`${PAGE}/${id}`);
    return { ok: true, message: 'Approved.' };
  } catch (err) {
    return fail(err);
  }
}

export async function reopenPayout(id: string): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();
    const row = await payoutRow(id, tenant.organizationId);
    if (!row) return { error: 'Payout not found.' };
    if (row.status !== 'APPROVED') return { error: 'Only an approved, unpaid payout can be reopened.' };
    await db.instructorPayout.update({ where: { id: row.id }, data: { status: 'DRAFT', approvedAt: null, approvedById: null } });
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'payout.reopen', entity: 'InstructorPayout', entityId: id });
    revalidatePath(PAGE);
    revalidatePath(`${PAGE}/${id}`);
    return { ok: true, message: 'Back to a draft.' };
  } catch (err) {
    return fail(err);
  }
}

export async function markPayoutPaid(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();
    const id = String(formData.get('id') ?? '');
    const reference = String(formData.get('reference') ?? '').trim();
    const paidOnRaw = String(formData.get('paidOn') ?? '');
    const paidOn = paidOnRaw ? new Date(paidOnRaw) : new Date();
    if (Number.isNaN(paidOn.getTime())) return { error: 'That date is not valid.' };
    const row = await payoutRow(id, tenant.organizationId);
    if (!row) return { error: 'Payout not found.' };
    if (row.status !== 'APPROVED') return { error: 'Approve it first.' };
    await db.instructorPayout.update({ where: { id: row.id }, data: { status: 'PAID', paidAt: paidOn, paidReference: reference || null } });
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'payout.paid', entity: 'InstructorPayout', entityId: id, after: { reference } });
    revalidatePath(PAGE);
    revalidatePath(`${PAGE}/${id}`);
    return { ok: true, message: 'Marked paid.' };
  } catch (err) {
    return fail(err);
  }
}

export async function deletePayout(id: string): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('delete');
    const row = await payoutRow(id, tenant.organizationId);
    if (!row) return { error: 'Payout not found.' };
    if (row.status !== 'DRAFT') return { error: 'Only a draft can be removed.' };
    await db.instructorPayout.delete({ where: { id: row.id } });
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'payout.delete', entity: 'InstructorPayout', entityId: id });
    revalidatePath(PAGE);
    return { ok: true, message: 'Removed.' };
  } catch (err) {
    return fail(err);
  }
}
