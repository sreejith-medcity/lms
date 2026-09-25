'use server';

import { after } from 'next/server';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import { resolveIntegration } from '@/lib/integration-store';
import { examFamilies, examFormat } from '@/lib/exams/registry';
import { criteriaFor } from '@/lib/exams/marking';
import { newDrawCode, normaliseDrawCode } from '@/lib/exams/draw';
import { scoreSitting } from '@/lib/exams/sittings';
import { pullAudio, setActive, type PullReport } from '@/lib/exams/content-admin';
import type { ActionState } from '@/server/courses';
import { slugify, uniqueSlug } from '@/lib/slug';
import { TEST_PERMS, endOfDayIn, phoneVariants } from '@/lib/exams/perms';

/**
 * The admin side of the test portal. The permissions are in
 * src/lib/exams/perms.ts, and every action checks the academy.
 */

async function guard(permission: string, action: 'view' | 'edit' | 'delete' = 'edit') {
  const [tenant, user] = await Promise.all([requireTenant(), requireStaff(permission, action)]);
  if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  console.error('[tests-admin]', message);
  return { error: 'Something went wrong. Please try again.' };
}

/* ------------------------------------------------------------ content */

export async function toggleSetAction(setId: string, active: boolean): Promise<ActionState> {
  try {
    const { tenant, user } = await guard(TEST_PERMS.content);
    await setActive(tenant.organizationId, setId, active);
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: active ? 'tests.set_on' : 'tests.set_off', entity: 'ExamSet', entityId: setId });
    revalidatePath('/admin/tests');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function pullAudioAction(formatCode: string): Promise<PullReport | { error: string }> {
  try {
    const { tenant, user } = await guard(TEST_PERMS.content);
    const telc = await resolveIntegration(tenant.organizationId, 'telc');
    const base = (telc?.values.baseUrl ?? '').trim() || 'https://telc.medcitylms.in';
    return await pullAudio(tenant.organizationId, user.id, formatCode, base);
  } catch (err) {
    return { error: fail(err).error ?? 'Something went wrong.' };
  }
}

/* ------------------------------------------------------------ marking */

export async function tutorMarkAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await guard(TEST_PERMS.marking);
    const id = String(formData.get('submissionId') ?? '');
    const raw = String(formData.get('points') ?? '').trim().replace(',', '.');
    const note = String(formData.get('note') ?? '').trim().slice(0, 2000);
    const sub = await db.examSubmission.findFirst({ where: { id, organizationId: tenant.organizationId }, include: { sitting: { select: { id: true, formatCode: true } } } });
    if (!sub) return { error: 'That answer is gone.' };
    const format = examFormat(sub.sitting.formatCode);
    const def = format?.blocks.find((b) => b.id === sub.task.split(':')[0]);
    if (!format || !def) return { error: 'This test is no longer known.' };
    const max = criteriaFor(format, def).reduce((a, c) => a + c.max, 0);

    /* An empty mark takes the tutor's mark away again, and the model's stands. */
    let points: number | null = null;
    if (raw !== '') {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || n > max) return { error: `A mark from 0 to ${String(max).replace('.', ',')}.` };
      points = Math.round(n * 2) / 2;
    }
    await db.examSubmission.update({
      where: { id: sub.id },
      data: { tutorPoints: points, tutorNote: points == null ? '' : note, markedById: points == null ? null : user.id, markedAt: points == null ? null : new Date() },
    });
    await scoreSitting(tenant.organizationId, sub.sitting.id, { callModel: false });
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'tests.marked', entity: 'ExamSubmission', entityId: sub.id, before: { tutorPoints: sub.tutorPoints }, after: { tutorPoints: points } });
    revalidatePath(`/admin/tests/sittings/${sub.sitting.id}`);
    return { ok: true, message: points == null ? 'Mark removed.' : 'Mark saved; the total is counted again.' };
  } catch (err) {
    return fail(err);
  }
}

/** The model tries again now, for every answer it has not marked. */
export async function remarkAction(sittingId: string): Promise<ActionState> {
  try {
    const { tenant } = await guard(TEST_PERMS.marking);
    const s = await db.examSitting.findFirst({ where: { id: sittingId, organizationId: tenant.organizationId }, select: { id: true } });
    if (!s) return { error: 'That paper is gone.' };
    await db.examSubmission.updateMany({ where: { sittingId, organizationId: tenant.organizationId, aiPoints: null }, data: { aiError: null } });
    after(() => scoreSitting(tenant.organizationId, sittingId, { callModel: true }));
    return { ok: true, message: 'Sent to the model. Refresh in a minute.' };
  } catch (err) {
    return fail(err);
  }
}

/** A paper that should not count: taken off the learner's results, and the paper given back when asked. */
export async function voidSittingAction(sittingId: string, giveBack: boolean): Promise<ActionState> {
  try {
    const { tenant, user } = await guard(TEST_PERMS.marking, 'delete');
    const s = await db.examSitting.findFirst({ where: { id: sittingId, organizationId: tenant.organizationId }, select: { id: true, status: true, allowanceId: true } });
    if (!s) return { error: 'That paper is gone.' };
    if (s.status === 'VOID') return { ok: true };
    await db.$transaction(async (tx) => {
      await tx.examSitting.update({ where: { id: s.id }, data: { status: 'VOID' } });
      if (giveBack && s.allowanceId) {
        await tx.$executeRaw`UPDATE "exam_allowances" SET "used" = GREATEST("used" - 1, 0) WHERE "id" = ${s.allowanceId}`;
      }
    });
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'tests.voided', entity: 'ExamSitting', entityId: s.id, after: { giveBack } });
    revalidatePath('/admin/tests/sittings');
    return { ok: true, message: giveBack ? 'Taken off, and the paper given back.' : 'Taken off.' };
  } catch (err) {
    return fail(err);
  }
}

/* ------------------------------------------------------------ free papers */

export async function grantAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await guard(TEST_PERMS.grants);
    const [family, levelRaw] = String(formData.get('target') ?? '').split(':');
    const fam = examFamilies().find((f) => f.family === family);
    if (!fam) return { error: 'Choose a test.' };
    const level = levelRaw && fam.levels.includes(levelRaw) ? levelRaw : null;
    const unlimited = formData.get('unlimited') === 'on';
    const tests = unlimited ? null : Math.round(Number(formData.get('tests') ?? 0));
    if (tests != null && (!Number.isFinite(tests) || tests < 1 || tests > 100)) return { error: 'From 1 to 100 papers, or unlimited.' };
    const days = Math.round(Number(formData.get('days') ?? 0));
    const expiresAt = days > 0 ? new Date(Date.now() + days * 86_400_000) : null;
    const note = String(formData.get('note') ?? '').trim().slice(0, 300);

    const wanted = [
      ...new Set(
        String(formData.get('learners') ?? '')
          .split(/[\s,;]+/)
          .map((x) => x.trim().toLowerCase())
          .filter(Boolean),
      ),
    ].slice(0, 500);
    if (!wanted.length) return { error: 'Add at least one email address or phone number.' };
    const emails = wanted.filter((x) => x.includes('@'));
    const phones = wanted.filter((x) => !x.includes('@')).flatMap(phoneVariants);
    const users = await db.user.findMany({
      where: {
        organizationId: tenant.organizationId,
        kind: 'LEARNER',
        OR: [{ email: { in: emails, mode: 'insensitive' } }, ...(phones.length ? [{ phone: { in: phones } }] : [])],
      },
      select: { id: true, email: true, phone: true },
    });
    const last10 = (x: string | null | undefined) => (x ?? '').replace(/\D/g, '').slice(-10);
    const missing = wanted.filter((x) =>
      x.includes('@') ? !users.some((u) => u.email?.toLowerCase() === x) : !users.some((u) => u.phone && last10(u.phone) === last10(x)),
    );
    if (!users.length) return { error: `Nobody found for ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ' and more' : ''}.` };

    await db.examAllowance.createMany({
      data: users.map((u) => ({ organizationId: tenant.organizationId, userId: u.id, familyCode: fam.family, level, tests, source: 'GRANT' as const, note, grantedById: user.id, expiresAt })),
    });
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'tests.granted', entity: 'ExamAllowance', after: { family: fam.family, level, tests, learners: users.length } });
    revalidatePath('/admin/tests/grants');
    const what = `${tests == null ? 'Unlimited papers' : `${tests} paper${tests === 1 ? '' : 's'}`} for ${users.length} learner${users.length === 1 ? '' : 's'}.`;
    return { ok: true, message: missing.length ? `${what} Not found: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ` and ${missing.length - 10} more` : ''}.` : what };
  } catch (err) {
    return fail(err);
  }
}

export async function revokeAllowanceAction(id: string): Promise<ActionState> {
  try {
    const { tenant, user } = await guard(TEST_PERMS.grants, 'delete');
    const a = await db.examAllowance.findFirst({ where: { id, organizationId: tenant.organizationId }, select: { id: true, source: true } });
    if (!a) return { error: 'That allowance is gone.' };
    if (a.source === 'COURSE') return { error: 'A course allowance follows the enrolment; end the enrolment instead.' };
    await db.examAllowance.update({ where: { id }, data: { revokedAt: new Date(), revokedById: user.id } });
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'tests.revoked', entity: 'ExamAllowance', entityId: id });
    revalidatePath('/admin/tests/grants');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/* ------------------------------------------------------------ set papers */

export async function createAssignmentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await guard(TEST_PERMS.assign);
    const format = examFormat(String(formData.get('formatCode') ?? ''));
    if (!format) return { error: 'Choose a test.' };
    const batchId = String(formData.get('batchId') ?? '');
    const batch = await db.batch.findFirst({ where: { id: batchId, organizationId: tenant.organizationId }, select: { id: true, name: true, branchId: true } });
    if (!batch) return { error: 'Choose a batch.' };
    const sectionId = String(formData.get('sectionId') ?? '') || null;
    if (sectionId && !format.sections.some((s) => s.id === sectionId)) return { error: 'That part is not in this test.' };
    const typed = String(formData.get('drawCode') ?? '').trim();
    const drawCode = typed ? normaliseDrawCode(typed) : newDrawCode();
    if (!drawCode) return { error: 'That paper code is not valid.' };
    const due = String(formData.get('dueAt') ?? '');
    const dueAt = due ? endOfDayIn(due, tenant.timezone || 'Asia/Kolkata') : null;
    const title = String(formData.get('title') ?? '').trim().slice(0, 120) || `${format.name}${sectionId ? `, ${format.sections.find((s) => s.id === sectionId)?.title}` : ''}`;
    const created = await db.examAssignment.create({
      data: { organizationId: tenant.organizationId, tutorId: user.id, batchId: batch.id, branchId: batch.branchId ?? null, formatCode: format.code, drawCode, title, note: String(formData.get('note') ?? '').trim().slice(0, 500), sectionId, dueAt },
      select: { id: true },
    });
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'tests.assigned', entity: 'ExamAssignment', entityId: created.id, after: { batch: batch.name, format: format.code, drawCode, sectionId } });
    revalidatePath('/admin/tests/assignments');
    return { ok: true, message: `Set for ${batch.name}, paper ${drawCode}.` };
  } catch (err) {
    return fail(err);
  }
}

export async function endAssignmentAction(id: string): Promise<ActionState> {
  try {
    const { tenant, user } = await guard(TEST_PERMS.assign);
    const n = await db.examAssignment.updateMany({ where: { id, organizationId: tenant.organizationId }, data: { active: false } });
    if (!n.count) return { error: 'That paper is gone.' };
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'tests.assignment_ended', entity: 'ExamAssignment', entityId: id });
    revalidatePath('/admin/tests/assignments');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/* ------------------------------------------------------------ packs */

/**
 * A pack is a TEST_SERIES product: a title, a price, and how many papers of
 * which test for how long. It is sold through the ordinary cart.
 */
export async function createPackAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await guard(TEST_PERMS.packs);
    const [family, levelRaw] = String(formData.get('target') ?? '').split(':');
    const fam = examFamilies().find((f) => f.family === family);
    if (!fam) return { error: 'Choose a test.' };
    const level = levelRaw && fam.levels.includes(levelRaw) ? levelRaw : null;
    const unlimited = formData.get('unlimited') === 'on';
    const tests = unlimited ? null : Math.round(Number(formData.get('tests') ?? 0));
    if (tests != null && (!Number.isFinite(tests) || tests < 1 || tests > 100)) return { error: 'From 1 to 100 papers, or unlimited.' };
    const days = Math.round(Number(formData.get('days') ?? 0));
    if (unlimited && !(days > 0)) return { error: 'Unlimited papers need a validity, or the pack never ends.' };
    const price = Number(String(formData.get('price') ?? '').replace(/,/g, ''));
    if (!Number.isFinite(price) || price < 1) return { error: 'A price of at least one rupee.' };
    const mrpRaw = String(formData.get('mrp') ?? '').replace(/,/g, '').trim();
    const mrp = mrpRaw ? Number(mrpRaw) : null;
    if (mrp != null && (!Number.isFinite(mrp) || mrp < price)) return { error: 'The crossed-out price must be above the price.' };
    const title =
      String(formData.get('title') ?? '').trim().slice(0, 120) ||
      `${fam.name}${level ? ` ${level}` : ''}: ${tests == null ? 'unlimited papers' : `${tests} mock test${tests === 1 ? '' : 's'}`}`;
    const description = String(formData.get('description') ?? '').trim().slice(0, 400) || null;
    const publish = formData.get('publish') === 'on';

    const slug = await uniqueSlug(slugify(title), async (candidate) =>
      Boolean(await db.product.findFirst({ where: { organizationId: tenant.organizationId, slug: candidate }, select: { id: true } })),
    );
    const created = await db.product.create({
      data: {
        organizationId: tenant.organizationId,
        type: 'TEST_SERIES',
        title,
        slug,
        status: publish ? 'PUBLISHED' : 'DRAFT',
        createdById: user.id,
        testPack: { create: { organizationId: tenant.organizationId, familyCode: fam.family, level, tests, validityDays: days > 0 ? days : null, description } },
        pricingPlans: { create: { name: 'Pack', pricePaise: Math.round(price * 100), mrpPaise: mrp != null ? Math.round(mrp * 100) : null, sortOrder: 0 } },
      },
      select: { id: true },
    });
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'tests.pack_created', entity: 'Product', entityId: created.id, after: { title, family: fam.family, level, tests, price } });
    revalidatePath('/admin/tests/packs');
    revalidatePath('/tests');
    return { ok: true, message: publish ? 'Pack on sale.' : 'Pack saved as a draft.' };
  } catch (err) {
    return fail(err);
  }
}

export async function setPackStatusAction(productId: string, status: 'PUBLISHED' | 'DRAFT' | 'ARCHIVED'): Promise<ActionState> {
  try {
    const { tenant, user } = await guard(TEST_PERMS.packs, status === 'ARCHIVED' ? 'delete' : 'edit');
    const n = await db.product.updateMany({
      where: { id: productId, organizationId: tenant.organizationId, type: 'TEST_SERIES' },
      data: status === 'ARCHIVED' ? { status: 'DRAFT', deletedAt: new Date() } : { status },
    });
    if (!n.count) return { error: 'That pack is gone.' };
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: `tests.pack_${status.toLowerCase()}`, entity: 'Product', entityId: productId });
    revalidatePath('/admin/tests/packs');
    revalidatePath('/tests');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function setPackPriceAction(productId: string, rupees: number): Promise<ActionState> {
  try {
    const { tenant, user } = await guard(TEST_PERMS.packs);
    if (!Number.isFinite(rupees) || rupees < 1) return { error: 'A price of at least one rupee.' };
    const plan = await db.pricingPlan.findFirst({ where: { product: { id: productId, organizationId: tenant.organizationId, type: 'TEST_SERIES' }, isActive: true }, orderBy: { sortOrder: 'asc' }, select: { id: true, pricePaise: true } });
    if (!plan) return { error: 'That pack has no price to change.' };
    await db.pricingPlan.update({ where: { id: plan.id }, data: { pricePaise: Math.round(rupees * 100) } });
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'tests.pack_price', entity: 'Product', entityId: productId, before: { pricePaise: plan.pricePaise }, after: { pricePaise: Math.round(rupees * 100) } });
    revalidatePath('/admin/tests/packs');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
