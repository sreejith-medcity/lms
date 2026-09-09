'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import { toPaise } from '@/lib/money';
import type { ActionState } from '@/server/courses';

/**
 * The cheque drawer.
 *
 * A cheque is money that has been handed over and not yet arrived, and an
 * institute that treats those two as the same thing books revenue it does not
 * have. So a cheque is written as a PENDING payment with the paper's details
 * beside it, and only clearing turns it into a captured one.
 */

async function guard(action: 'view' | 'edit' | 'delete' = 'edit') {
  const [tenant, user] = await Promise.all([
    requireTenant(),
    requireStaff('sales.cheques', action),
  ]);
  if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  console.error('[cheques]', message);
  return { error: 'Something went wrong. Please try again.' };
}

const chequeShape = z.object({
  userId: z.string().trim().optional(),
  studentName: z.string().trim().min(2, 'Whose fees is this?').max(160),
  parentName: z.string().trim().max(160).optional(),
  bankName: z.string().trim().min(2, 'Which bank?').max(120),
  chequeNo: z.string().trim().min(3, 'The cheque number').max(40),
  chequeDate: z.string().min(1, 'The date on the cheque'),
  amountRupees: z.coerce.number().min(1, 'How much is it for?'),
  remark: z.string().trim().max(300).optional(),
});

export async function recordCheque(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();

    const parsed = chequeShape.safeParse({
      userId: formData.get('userId') || undefined,
      studentName: formData.get('studentName'),
      parentName: formData.get('parentName') || undefined,
      bankName: formData.get('bankName'),
      chequeNo: formData.get('chequeNo'),
      chequeDate: formData.get('chequeDate'),
      amountRupees: formData.get('amountRupees'),
      remark: formData.get('remark') || undefined,
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const d = parsed.data;

    const learner = d.userId
      ? await db.user.findFirst({
          where: { id: d.userId, organizationId: tenant.organizationId },
          select: { id: true },
        })
      : null;

    const duplicate = await db.cheque.findFirst({
      where: {
        chequeNo: d.chequeNo,
        bankName: d.bankName,
        payment: { organizationId: tenant.organizationId },
      },
      select: { id: true },
    });
    if (duplicate) {
      return { error: `Cheque ${d.chequeNo} from ${d.bankName} is already in the drawer.` };
    }

    // The payment is created PENDING: the paper is in hand, the money is not.
    const payment = await db.payment.create({
      data: {
        organizationId: tenant.organizationId,
        userId: learner?.id ?? null,
        gateway: 'CHEQUE',
        method: 'cheque',
        amountPaise: toPaise(d.amountRupees),
        status: 'PENDING',
        raw: { recordedBy: user.id } as Prisma.InputJsonValue,
        cheque: {
          create: {
            studentName: d.studentName,
            parentName: d.parentName || null,
            bankName: d.bankName,
            chequeNo: d.chequeNo,
            chequeDate: new Date(d.chequeDate),
            status: 'PENDING',
            remark: d.remark || null,
          },
        },
      },
      select: { id: true },
    });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'cheque.recorded',
      entity: 'Payment',
      entityId: payment.id,
      after: { chequeNo: d.chequeNo, bank: d.bankName, amountPaise: toPaise(d.amountRupees) },
    });

    revalidatePath('/admin/cheques');
    revalidatePath('/admin/payments');
    return { ok: true, message: `Cheque ${d.chequeNo} is in the drawer.` };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Clearing or bouncing one.
 *
 * Both are recorded rather than edited over: a bounced cheque is a fact about a
 * learner's account, and deleting it is how a second bounce comes as a surprise.
 */
export async function settleCheque(
  chequeId: string,
  outcome: 'CLEARED' | 'BOUNCED',
  remark?: string,
): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();

    const cheque = await db.cheque.findFirst({
      where: { id: chequeId, payment: { organizationId: tenant.organizationId } },
      select: {
        id: true,
        status: true,
        chequeNo: true,
        payment: { select: { id: true, amountPaise: true } },
      },
    });
    if (!cheque) return { error: 'Cheque not found.' };
    if (cheque.status !== 'PENDING') {
      return { error: `That cheque is already marked ${cheque.status.toLowerCase()}.` };
    }

    await db.$transaction([
      db.cheque.update({
        where: { id: chequeId },
        data: { status: outcome, remark: remark?.trim() || undefined },
      }),
      db.payment.update({
        where: { id: cheque.payment.id },
        data:
          outcome === 'CLEARED'
            ? { status: 'CAPTURED', capturedAt: new Date() }
            : { status: 'FAILED', failureReason: remark?.trim() || 'Cheque bounced' },
      }),
    ]);

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: outcome === 'CLEARED' ? 'cheque.cleared' : 'cheque.bounced',
      entity: 'Payment',
      entityId: cheque.payment.id,
      after: { chequeNo: cheque.chequeNo, amountPaise: cheque.payment.amountPaise },
    });

    revalidatePath('/admin/cheques');
    revalidatePath('/admin/payments');
    return {
      ok: true,
      message:
        outcome === 'CLEARED'
          ? 'Cleared, and counted as collected.'
          : 'Marked bounced. It no longer counts as collected.',
    };
  } catch (err) {
    return fail(err);
  }
}
