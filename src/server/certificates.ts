'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import type { Prisma } from '@prisma/client';
import type { ActionState } from '@/server/courses';

/**
 * Certificates.
 *
 * A certificate is a claim an academy makes in public, so three things are
 * non-negotiable here: the serial is sequential and never reused, every issue is
 * checkable by a stranger with only the code on the paper, and revoking one
 * leaves the record standing and says it was revoked rather than deleting it.
 * A certificate that quietly disappears is worse than one marked withdrawn.
 */

async function guard(action: 'view' | 'edit' | 'delete' = 'edit') {
  const [tenant, user] = await Promise.all([
    requireTenant(),
    requireStaff(action === 'delete' ? 'certificates.revoke_certificates' : 'certificates.manage_templates', action === 'delete' ? 'delete' : 'edit'),
  ]);
  if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  console.error('[certificates]', message);
  return { error: 'Something went wrong. Please try again.' };
}

const template = z.object({
  id: z.string().optional().or(z.literal('')),
  name: z.string().trim().min(2, 'Give the template a name').max(120),
  serialPrefix: z
    .string()
    .trim()
    .min(2, 'The serial prefix needs at least two characters')
    .max(12)
    .regex(/^[A-Za-z0-9-]+$/, 'Letters, numbers and hyphens only'),
  headline: z.string().trim().min(2).max(120),
  body: z.string().trim().min(10).max(1000),
  signatoryName: z.string().trim().max(80).optional().or(z.literal('')),
  signatoryRole: z.string().trim().max(80).optional().or(z.literal('')),
  validityMonths: z.coerce.number().min(0).max(600).optional(),
  autoIssueOn: z.enum(['MANUAL', 'COURSE_COMPLETION']),
});

export async function saveTemplate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();

    const parsed = template.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const d = parsed.data;
    const designJson = {
      headline: d.headline,
      body: d.body,
      signatoryName: d.signatoryName || '',
      signatoryRole: d.signatoryRole || '',
      accent: '',
    } as Prisma.InputJsonValue;

    const data = {
      name: d.name,
      serialPrefix: d.serialPrefix.toUpperCase(),
      designJson,
      validityMonths: d.validityMonths ? d.validityMonths : null,
      autoIssueOn: d.autoIssueOn,
    };

    if (d.id) {
      const owned = await db.certificateTemplate.findFirst({
        where: { id: d.id, organizationId: tenant.organizationId },
        select: { id: true, serialPrefix: true, _count: { select: { issued: true } } },
      });
      if (!owned) return { error: 'Template not found.' };

      // Changing the prefix after certificates exist would make two different
      // series look like one. The wording can change; the numbering cannot.
      if (owned._count.issued > 0 && owned.serialPrefix !== data.serialPrefix) {
        return {
          error: `${owned._count.issued} certificate${owned._count.issued === 1 ? ' has' : 's have'} been issued under ${owned.serialPrefix}. The prefix is fixed now.`,
        };
      }

      await db.certificateTemplate.update({ where: { id: d.id }, data });
    } else {
      await db.certificateTemplate.create({
        data: { ...data, organizationId: tenant.organizationId },
      });
    }

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: d.id ? 'certificate.template.updated' : 'certificate.template.created',
      entity: 'CertificateTemplate',
      entityId: d.id || null,
      after: { name: d.name, autoIssueOn: d.autoIssueOn },
    });

    revalidatePath('/admin/certificates');
    return { ok: true, message: 'Saved.' };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Issues one. The serial comes from the template's counter, taken inside a
 * transaction, so two people clicking at once cannot land on the same number.
 */
export async function issueCertificate(
  templateId: string,
  enrollmentId: string,
): Promise<ActionState & { serialNo?: string }> {
  try {
    const { tenant, user } = await guard();

    const [tpl, enrollment] = await Promise.all([
      db.certificateTemplate.findFirst({
        where: { id: templateId, organizationId: tenant.organizationId },
        select: { id: true, serialPrefix: true, validityMonths: true },
      }),
      db.enrollment.findFirst({
        where: { id: enrollmentId, organizationId: tenant.organizationId },
        select: { id: true, userId: true, product: { select: { title: true } } },
      }),
    ]);
    if (!tpl || !enrollment) return { error: 'Not found.' };

    const existing = await db.issuedCertificate.findFirst({
      where: { templateId, enrollmentId, revokedAt: null },
      select: { serialNo: true },
    });
    if (existing) return { error: `Already issued as ${existing.serialNo}.` };

    const serialNo = await db.$transaction(async (tx) => {
      const claimed = await tx.certificateTemplate.update({
        where: { id: templateId },
        data: { nextSerial: { increment: 1 } },
        select: { nextSerial: true, serialPrefix: true },
      });
      const number = claimed.nextSerial - 1;
      const serial = `${claimed.serialPrefix}-${String(number).padStart(5, '0')}`;

      await tx.issuedCertificate.create({
        data: {
          templateId,
          userId: enrollment.userId,
          enrollmentId,
          serialNo: serial,
          expiresAt: tpl.validityMonths
            ? new Date(Date.now() + tpl.validityMonths * 30 * 864e5)
            : null,
        },
      });

      return serial;
    });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'certificate.issued',
      entity: 'IssuedCertificate',
      after: { serialNo, learner: enrollment.userId, course: enrollment.product.title },
    });

    revalidatePath('/admin/certificates');
    return { ok: true, serialNo, message: `Issued as ${serialNo}.` };
  } catch (err) {
    return fail(err);
  }
}

/** Withdrawn, not deleted. The verify page then says so, which is the point. */
export async function revokeCertificate(id: string, reason: string): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('delete');

    const cert = await db.issuedCertificate.findFirst({
      where: { id, template: { organizationId: tenant.organizationId } },
      select: { id: true, serialNo: true, revokedAt: true },
    });
    if (!cert) return { error: 'Certificate not found.' };
    if (cert.revokedAt) return { error: 'Already revoked.' };

    await db.issuedCertificate.update({ where: { id }, data: { revokedAt: new Date() } });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'certificate.revoked',
      entity: 'IssuedCertificate',
      entityId: id,
      after: { serialNo: cert.serialNo, reason },
    });

    revalidatePath('/admin/certificates');
    return { ok: true, message: `${cert.serialNo} is now marked withdrawn. It is not deleted.` };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Called when an enrolment reaches 100%. Silent by design: a learner finishing a
 * course should not depend on someone remembering to press a button, and a
 * failure here must never roll back the progress that triggered it.
 */
export async function autoIssueOnCompletion(enrollmentId: string): Promise<void> {
  try {
    const enrollment = await db.enrollment.findUnique({
      where: { id: enrollmentId },
      select: { id: true, userId: true, organizationId: true, status: true },
    });
    if (!enrollment || enrollment.status !== 'COMPLETED') return;

    const template = await db.certificateTemplate.findFirst({
      where: { organizationId: enrollment.organizationId, autoIssueOn: 'COURSE_COMPLETION' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, validityMonths: true },
    });
    if (!template) return;

    const existing = await db.issuedCertificate.findFirst({
      where: { templateId: template.id, enrollmentId, revokedAt: null },
      select: { id: true },
    });
    if (existing) return;

    await db.$transaction(async (tx) => {
      const claimed = await tx.certificateTemplate.update({
        where: { id: template.id },
        data: { nextSerial: { increment: 1 } },
        select: { nextSerial: true, serialPrefix: true },
      });

      await tx.issuedCertificate.create({
        data: {
          templateId: template.id,
          userId: enrollment.userId,
          enrollmentId,
          serialNo: `${claimed.serialPrefix}-${String(claimed.nextSerial - 1).padStart(5, '0')}`,
          expiresAt: template.validityMonths
            ? new Date(Date.now() + template.validityMonths * 30 * 864e5)
            : null,
        },
      });
    });
  } catch (err) {
    console.error('[certificates] auto issue failed', err instanceof Error ? err.message : err);
  }
}
