'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { $Enums } from '@prisma/client';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import { canSeeBatch, staffScope, type StaffScope } from '@/lib/scope';
import { parseBands } from '@/lib/grading';
import { canTransition, computeEntry, editable, entryProblem, reviewSheet, type EntryInput, type Outcome, type SheetRules } from '@/lib/mark-sheets';
import { STANDARD_CATEGORIES } from '@/lib/programs';
import { settingBool } from '@/lib/settings/store';
import { notifyParents, type ParentAlert } from '@/lib/parent-notify';
import { happened } from '@/lib/events';
import { dayKey, formatDayLabel } from '@/lib/clock';
import type { ActionState } from '@/server/courses';

/**
 * Mark sheets: entered by a teacher, published by the batch's Branch Head.
 *
 * The gate is the point. A parent sees a result only once somebody who
 * answers for the branch has read the sheet and pressed publish, and a
 * correction after that goes through the same door. So the teacher's
 * actions here move a sheet to SUBMITTED and no further; the approver's
 * move it to PUBLISHED or back to RETURNED with a reason.
 */

async function guard() {
  const [tenant, user] = await Promise.all([requireTenant(), requireStaff('courses.assessments', 'edit')]);
  if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  console.error('[mark-sheets]', message);
  return { error: 'Something went wrong. Nothing was saved; please try again.' };
}

/** A teacher's scope is their batches; anyone wider than that answers for a branch. */
function isApprover(scope: StaffScope): boolean {
  return scope.kind !== 'batches';
}

async function rulesFor(organizationId: string, sheet: { maxMarks: number; passPercent: number | null; batch: { course: { program: { gradeScaleId: string | null; passPercent: number | null } | null } } }): Promise<SheetRules> {
  const program = sheet.batch.course.program;
  const scale = program?.gradeScaleId
    ? await db.gradeScale.findFirst({ where: { id: program.gradeScaleId, organizationId }, select: { bands: true } })
    : await db.gradeScale.findFirst({ where: { organizationId, isActive: true }, select: { bands: true } });
  return { maxMarks: sheet.maxMarks, passPercent: sheet.passPercent ?? program?.passPercent ?? null, bands: scale ? parseBands(scale.bands) : [] };
}

async function loadSheet(organizationId: string, id: string) {
  return db.markSheet.findFirst({
    where: { id, organizationId },
    select: {
      id: true,
      title: true,
      status: true,
      maxMarks: true,
      passPercent: true,
      batchId: true,
      supersedesId: true,
      supersededById: true,
      version: true,
      createdById: true,
      submittedById: true,
      batch: { select: { id: true, name: true, branchId: true, course: { select: { program: { select: { gradeScaleId: true, passPercent: true } } } }, enrollments: { where: { status: { in: ['ENROLLED', 'COMPLETED', 'ON_LEAVE'] } }, select: { user: { select: { id: true, name: true } } } } } },
      entries: { select: { userId: true, outcome: true, marks: true, remark: true, override: true } },
    },
  });
}

export async function createMarkSheet(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let created: string | null = null;
  try {
    const { tenant, user } = await guard();
    const scope = await staffScope(user);
    const batchId = String(formData.get('batchId') ?? '');
    const title = String(formData.get('title') ?? '').trim().slice(0, 160);
    const category = String(formData.get('category') ?? '').trim().slice(0, 60);
    const skill = String(formData.get('skill') ?? '').trim().slice(0, 60) || null;
    const testDate = String(formData.get('testDate') ?? '');
    const maxMarks = Number(formData.get('maxMarks') ?? 0);
    const passRaw = String(formData.get('passPercent') ?? '').trim();

    if (title.length < 2) return { error: 'Give the test a title.' };
    if (!category) return { error: 'Pick the kind of test.' };
    if (!Number.isFinite(maxMarks) || maxMarks <= 0 || maxMarks > 10000) return { error: 'Maximum marks must be above zero.' };
    const date = testDate ? new Date(testDate) : null;
    if (!date || Number.isNaN(date.getTime())) return { error: 'When was the test?' };
    const passPercent = passRaw ? Number(passRaw) : null;
    if (passPercent !== null && (!Number.isFinite(passPercent) || passPercent < 0 || passPercent > 100)) return { error: 'The pass mark is a percentage.' };

    const batch = await db.batch.findFirst({
      where: { id: batchId, organizationId: tenant.organizationId, deletedAt: null },
      select: { id: true, branchId: true, level: true, course: { select: { program: { select: { assessmentCategories: true, skills: true } } } } },
    });
    if (!batch || !canSeeBatch(scope, batch)) return { error: 'Batch not found.' };
    const allowed = batch.course.program?.assessmentCategories.length ? batch.course.program.assessmentCategories : [...STANDARD_CATEGORIES];
    if (!allowed.includes(category)) return { error: 'That kind of test is not one the program allows.' };
    if (skill && batch.course.program?.skills.length && !batch.course.program.skills.includes(skill)) return { error: 'That skill is not one the program lists.' };

    const sheet = await db.markSheet.create({
      data: { organizationId: tenant.organizationId, batchId: batch.id, title, category, skill, level: batch.level, testDate: date, maxMarks, passPercent, createdById: user.id },
      select: { id: true },
    });
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'mark_sheet.created', entity: 'MarkSheet', entityId: sheet.id, after: { title, category, batchId: batch.id, maxMarks } });
    created = sheet.id;
  } catch (err) {
    return fail(err);
  }
  redirect(`/admin/marksheets/${created}`);
}

/** Draws a sheet from an online paper's evaluated attempts, so it can go through the same gate. */
export async function drawMarkSheet(assessmentId: string, batchId: string): Promise<ActionState & { id?: string }> {
  try {
    const { tenant, user } = await guard();
    const scope = await staffScope(user);
    const [assessment, batch] = await Promise.all([
      db.assessment.findFirst({ where: { id: assessmentId, organizationId: tenant.organizationId }, select: { id: true, title: true, category: true, skill: true, level: true, passPercent: true, questions: { select: { marks: true } } } }),
      db.batch.findFirst({ where: { id: batchId, organizationId: tenant.organizationId, deletedAt: null }, select: { id: true, branchId: true, level: true, enrollments: { where: { status: { in: ['ENROLLED', 'COMPLETED', 'ON_LEAVE'] } }, select: { userId: true } } } }),
    ]);
    if (!assessment || !batch || !canSeeBatch(scope, batch)) return { error: 'Not found.' };
    const learnerIds = batch.enrollments.map((e) => e.userId);
    const attempts = await db.attempt.findMany({
      where: { assessmentId: assessment.id, userId: { in: learnerIds }, status: 'EVALUATED', assessment: { organizationId: tenant.organizationId } },
      orderBy: { submittedAt: 'desc' },
      select: { userId: true, scorePercent: true, submittedAt: true },
    });
    if (attempts.length === 0) return { error: 'Nobody in this batch has an evaluated attempt at that paper yet.' };
    const maxMarks = assessment.questions.reduce((n, q) => n + (q.marks ?? 0), 0) || 100;
    // Latest evaluated attempt per learner; the program's retest rule is
    // applied on the trend, not here, because a sheet is one sitting.
    const latest = new Map<string, { percent: number; at: Date | null }>();
    for (const a of attempts) if (!latest.has(a.userId) && a.scorePercent !== null) latest.set(a.userId, { percent: a.scorePercent, at: a.submittedAt });
    const testDate = attempts[0].submittedAt ?? new Date();

    const sheet = await db.markSheet.create({
      data: {
        organizationId: tenant.organizationId,
        batchId: batch.id,
        assessmentId: assessment.id,
        title: assessment.title,
        category: assessment.category ?? 'Class Test',
        skill: assessment.skill,
        level: assessment.level ?? batch.level,
        testDate,
        maxMarks,
        passPercent: assessment.passPercent,
        createdById: user.id,
        entries: {
          create: learnerIds.map((userId) => {
            const hit = latest.get(userId);
            return hit
              ? { userId, outcome: 'SCORED' as const, marks: Math.round((hit.percent / 100) * maxMarks * 100) / 100 }
              : { userId, outcome: 'NOT_ASSESSED' as const };
          }),
        },
      },
      select: { id: true },
    });
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'mark_sheet.drawn', entity: 'MarkSheet', entityId: sheet.id, after: { assessmentId: assessment.id, batchId: batch.id, learners: learnerIds.length, scored: latest.size } });
    return { ok: true, id: sheet.id };
  } catch (err) {
    return fail(err);
  }
}

export async function saveMarkSheetEntries(sheetId: string, rows: { userId: string; outcome: string; marks: string; remark: string; override: string }[]): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();
    const scope = await staffScope(user);
    const sheet = await loadSheet(tenant.organizationId, sheetId);
    if (!sheet || !canSeeBatch(scope, sheet.batch)) return { error: 'Sheet not found.' };
    if (!editable(sheet.status)) return { error: sheet.status === 'PUBLISHED' ? 'This sheet is published. Press "Correct" to make a new version.' : 'This sheet is with the Branch Head; wait for it to come back.' };

    const roll = new Set(sheet.batch.enrollments.map((e) => e.user.id));
    const rules = await rulesFor(tenant.organizationId, sheet);
    const clean: EntryInput[] = [];
    for (const r of rows) {
      if (!roll.has(r.userId)) continue;
      const outcome: Outcome = r.outcome === 'ABSENT' || r.outcome === 'NOT_ASSESSED' ? r.outcome : 'SCORED';
      const marksRaw = r.marks.trim();
      const marks = outcome === 'SCORED' ? (marksRaw === '' ? null : Number(marksRaw)) : null;
      if (outcome === 'SCORED' && marksRaw !== '' && !Number.isFinite(marks)) return { error: `A mark for one learner is not a number.` };
      const e: EntryInput = { userId: r.userId, outcome, marks: marks === null ? null : Math.round(marks * 100) / 100, remark: r.remark.trim().slice(0, 500) || null, override: r.override.trim().slice(0, 300) || null };
      // A draft may hold a blank line; anything else wrong is refused now.
      const problem = entryProblem(e, rules);
      if (problem && !problem.startsWith('has no mark')) return { error: `${sheet.batch.enrollments.find((x) => x.user.id === r.userId)?.user.name ?? 'A learner'} ${problem}` };
      clean.push(e);
    }

    for (const e of clean) {
      const c = computeEntry(e, rules);
      // A blank scored line is dropped rather than stored as "not assessed",
      // so the review still names the learner as missing.
      if (e.outcome === 'SCORED' && e.marks === null) {
        await db.markSheetEntry.deleteMany({ where: { sheetId: sheet.id, userId: e.userId } });
        continue;
      }
      await db.markSheetEntry.upsert({
        where: { sheetId_userId: { sheetId: sheet.id, userId: e.userId } },
        create: { sheetId: sheet.id, userId: e.userId, outcome: e.outcome, marks: c.marks, grade: c.grade, passed: c.passed, remark: e.remark, override: e.override },
        update: { outcome: e.outcome, marks: c.marks, grade: c.grade, passed: c.passed, remark: e.remark, override: e.override },
      });
    }
    await db.markSheet.update({ where: { id: sheet.id }, data: { updatedAt: new Date() } });
    revalidatePath(`/admin/marksheets/${sheet.id}`);
    return { ok: true, message: 'Draft saved.' };
  } catch (err) {
    return fail(err);
  }
}

export async function submitMarkSheet(sheetId: string): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();
    const scope = await staffScope(user);
    const sheet = await loadSheet(tenant.organizationId, sheetId);
    if (!sheet || !canSeeBatch(scope, sheet.batch)) return { error: 'Sheet not found.' };
    if (!canTransition(sheet.status, 'SUBMITTED', 'teacher')) return { error: 'This sheet cannot be submitted from where it is.' };

    const rules = await rulesFor(tenant.organizationId, sheet);
    const roster = sheet.batch.enrollments.map((e) => ({ userId: e.user.id, name: e.user.name }));
    const review = reviewSheet(roster, sheet.entries.map((e) => ({ userId: e.userId, outcome: e.outcome, marks: e.marks, remark: e.remark, override: e.override })), rules);
    if (review.problems.length) return { error: review.problems[0] };
    if (review.scored + review.absent + review.notAssessed === 0) return { error: 'Nothing is entered yet.' };

    await db.markSheet.update({ where: { id: sheet.id }, data: { status: 'SUBMITTED', submittedAt: new Date(), submittedById: user.id, returnReason: null } });
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'mark_sheet.submitted', entity: 'MarkSheet', entityId: sheet.id, after: { scored: review.scored, absent: review.absent, notAssessed: review.notAssessed, missing: review.missing.length } });
    revalidatePath(`/admin/marksheets/${sheet.id}`);
    revalidatePath('/admin/approvals');
    return { ok: true, message: review.missing.length ? `Submitted for approval. ${review.missing.length} learner${review.missing.length === 1 ? ' has' : 's have'} no line and will be shown as not assessed.` : 'Submitted for approval.' };
  } catch (err) {
    return fail(err);
  }
}

/** The Branch Head's decision. */
export async function decideMarkSheet(sheetId: string, decision: 'PUBLISHED' | 'RETURNED', reason: string): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();
    const scope = await staffScope(user);
    if (!isApprover(scope)) return { error: 'Results are approved by the Branch Head, not by the teacher who entered them.' };
    const sheet = await loadSheet(tenant.organizationId, sheetId);
    if (!sheet || !canSeeBatch(scope, sheet.batch)) return { error: 'Sheet not found.' };
    if (!canTransition(sheet.status, decision, 'approver')) return { error: 'This sheet is not waiting for a decision.' };
    if (sheet.submittedById && sheet.submittedById === user.id && scope.kind !== 'all') return { error: 'The person who submitted a sheet does not approve it. Ask the Branch Head or Head Office.' };
    const why = reason.trim().slice(0, 500);
    if (decision === 'RETURNED' && !why) return { error: 'Say what needs correcting; it goes back to the teacher with the sheet.' };

    if (decision === 'RETURNED') {
      await db.markSheet.update({ where: { id: sheet.id }, data: { status: 'RETURNED', decidedAt: new Date(), decidedById: user.id, returnReason: why } });
      await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'mark_sheet.returned', entity: 'MarkSheet', entityId: sheet.id, after: { reason: why } });
      revalidatePath(`/admin/marksheets/${sheet.id}`);
      revalidatePath('/admin/approvals');
      return { ok: true, message: 'Returned to the teacher.' };
    }

    const now = new Date();
    await db.$transaction([
      db.markSheet.update({ where: { id: sheet.id }, data: { status: 'PUBLISHED', decidedAt: now, decidedById: user.id, publishedAt: now, returnReason: null } }),
      // The version this one corrects steps aside; it stays readable as history.
      ...(sheet.supersedesId ? [db.markSheet.updateMany({ where: { id: sheet.supersedesId, organizationId: tenant.organizationId }, data: { supersededById: sheet.id } })] : []),
    ]);
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'mark_sheet.published', entity: 'MarkSheet', entityId: sheet.id, after: { version: sheet.version, supersedes: sheet.supersedesId, entries: sheet.entries.length } });
    await tellParents(tenant.organizationId, sheet.id, Boolean(sheet.supersedesId));
    revalidatePath(`/admin/marksheets/${sheet.id}`);
    revalidatePath('/admin/approvals');
    return { ok: true, message: sheet.supersedesId ? 'Published. The corrected version now replaces the earlier one for parents.' : 'Published. Parents can see it now.' };
  } catch (err) {
    return fail(err);
  }
}

/** A correction: a new draft that copies the published sheet and supersedes it once approved. */
export async function correctMarkSheet(sheetId: string, reason: string): Promise<ActionState & { id?: string }> {
  try {
    const { tenant, user } = await guard();
    const scope = await staffScope(user);
    const sheet = await db.markSheet.findFirst({
      where: { id: sheetId, organizationId: tenant.organizationId },
      select: { id: true, status: true, supersededById: true, batchId: true, assessmentId: true, title: true, category: true, skill: true, level: true, testDate: true, maxMarks: true, passPercent: true, assetIds: true, version: true, batch: { select: { id: true, branchId: true } }, entries: { select: { userId: true, outcome: true, marks: true, grade: true, passed: true, remark: true, override: true } }, corrected: { select: { id: true, status: true } } },
    });
    if (!sheet || !canSeeBatch(scope, sheet.batch)) return { error: 'Sheet not found.' };
    if (sheet.status !== 'PUBLISHED' || sheet.supersededById) return { error: 'Only the current published version can be corrected.' };
    if (sheet.corrected && sheet.corrected.status !== 'PUBLISHED') return { ok: true, id: sheet.corrected.id, message: 'A correction is already in progress.' };
    const why = reason.trim().slice(0, 500);
    if (!why) return { error: 'Say why the published result is being corrected.' };

    const draft = await db.markSheet.create({
      data: {
        organizationId: tenant.organizationId,
        batchId: sheet.batchId,
        assessmentId: sheet.assessmentId,
        title: sheet.title,
        category: sheet.category,
        skill: sheet.skill,
        level: sheet.level,
        testDate: sheet.testDate,
        maxMarks: sheet.maxMarks,
        passPercent: sheet.passPercent,
        assetIds: sheet.assetIds,
        createdById: user.id,
        supersedesId: sheet.id,
        correctionReason: why,
        version: sheet.version + 1,
        entries: { create: sheet.entries.map((e) => ({ userId: e.userId, outcome: e.outcome, marks: e.marks, grade: e.grade, passed: e.passed, remark: e.remark, override: e.override })) },
      },
      select: { id: true },
    });
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'mark_sheet.correction_started', entity: 'MarkSheet', entityId: draft.id, after: { supersedes: sheet.id, reason: why, version: sheet.version + 1 } });
    return { ok: true, id: draft.id };
  } catch (err) {
    return fail(err);
  }
}

export async function attachToMarkSheet(sheetId: string, assetId: string, on: boolean): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();
    const scope = await staffScope(user);
    const sheet = await db.markSheet.findFirst({ where: { id: sheetId, organizationId: tenant.organizationId }, select: { id: true, status: true, assetIds: true, batch: { select: { id: true, branchId: true } } } });
    if (!sheet || !canSeeBatch(scope, sheet.batch)) return { error: 'Sheet not found.' };
    if (!editable(sheet.status)) return { error: 'Files change only on a draft.' };
    const asset = await db.asset.findFirst({ where: { id: assetId, organizationId: tenant.organizationId, deletedAt: null }, select: { id: true } });
    if (!asset) return { error: 'File not found.' };
    const next = on ? Array.from(new Set([...sheet.assetIds, asset.id])).slice(0, 5) : sheet.assetIds.filter((a) => a !== asset.id);
    await db.markSheet.update({ where: { id: sheet.id }, data: { assetIds: next } });
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: on ? 'mark_sheet.file_attached' : 'mark_sheet.file_removed', entity: 'MarkSheet', entityId: sheet.id, after: { assetId } });
    revalidatePath(`/admin/marksheets/${sheet.id}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteMarkSheetDraft(sheetId: string): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();
    const scope = await staffScope(user);
    const sheet = await db.markSheet.findFirst({ where: { id: sheetId, organizationId: tenant.organizationId }, select: { id: true, status: true, title: true, batch: { select: { id: true, branchId: true } } } });
    if (!sheet || !canSeeBatch(scope, sheet.batch)) return { error: 'Sheet not found.' };
    if (sheet.status !== 'DRAFT') return { error: 'Only a draft can be discarded.' };
    await db.markSheet.delete({ where: { id: sheet.id } });
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'mark_sheet.discarded', entity: 'MarkSheet', entityId: sheet.id, after: { title: sheet.title } });
    revalidatePath('/admin/marksheets');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/** Parents of every learner on the sheet, once it is published: one line each in the inbox, and the outside channels. */
async function tellParents(organizationId: string, sheetId: string, corrected: boolean): Promise<void> {
  if (!(await settingBool(organizationId, 'academics.notifyResults'))) return;
  const sheet = await db.markSheet.findFirst({
    where: { id: sheetId, organizationId },
    select: { id: true, title: true, category: true, testDate: true, entries: { select: { userId: true, outcome: true, user: { select: { name: true, parentLinks: { where: { status: 'ACTIVE' }, select: { contact: true, name: true } } } } } } },
  });
  if (!sheet) return;
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true, name: true } });
  const tz = org?.timezone || 'Asia/Kolkata';
  const when = formatDayLabel(dayKey(sheet.testDate, tz), tz);
  const alerts: ParentAlert[] = [];
  for (const e of sheet.entries) {
    for (const l of e.user.parentLinks) {
      const title = corrected ? `Corrected result: ${e.user.name}, ${sheet.title}` : `Result published: ${e.user.name}, ${sheet.title}`;
      const body = `${sheet.category} on ${when}. Open the academics page to see the mark, the grade and the teacher's remark.`;
      alerts.push({ contact: l.contact, name: l.name, learnerId: e.userId, kind: 'result.published', title, body, href: `/parent/${e.userId}`, dedupeKey: `result:${sheet.id}:${e.userId}:${l.contact}`, vars: { learner: e.user.name } });
    }
  }
  if (alerts.length === 0) return;
  const sent = await notifyParents({
    organizationId,
    eventKey: 'result.published',
    alerts,
    context: { title: sheet.title, category: sheet.category, date: when, organization: org?.name ?? '' },
    pushBody: 'A result was published. Open the parent view to see it.',
  });
  if (sent.written === 0) return;
  await happened({ organizationId, key: 'result.published', subjectId: sheet.id, data: { title: sheet.title, parents: String(sent.written), corrected: String(corrected) } });
}

/* Homework verification ---------------------------------------------------- */

export async function verifyHomework(submissionId: string, verification: $Enums.HomeworkVerification, feedback: string): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();
    const scope = await staffScope(user);
    const sub = await db.assignmentSubmission.findFirst({
      where: { id: submissionId, organizationId: tenant.organizationId },
      select: { id: true, status: true, assignmentId: true, userId: true, assignment: { select: { batchId: true, batch: { select: { id: true, branchId: true } } } } },
    });
    if (!sub) return { error: 'Hand-in not found.' };
    if (sub.assignment.batch && !canSeeBatch(scope, sub.assignment.batch)) return { error: 'That batch is outside your scope.' };
    const note = feedback.trim().slice(0, 1000);
    await db.assignmentSubmission.update({
      where: { id: sub.id },
      data: {
        verification,
        verifiedAt: new Date(),
        verifiedById: user.id,
        ...(note ? { feedback: note } : {}),
        // "Hand it in again" reopens the door the way a return does.
        ...(verification === 'RESUBMIT' && sub.status !== 'GRADED' ? { status: 'RETURNED' } : {}),
      },
    });
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'homework.verified', entity: 'AssignmentSubmission', entityId: sub.id, after: { verification, feedback: note || null } });
    revalidatePath(`/admin/assignments/${sub.assignmentId}/verify`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
