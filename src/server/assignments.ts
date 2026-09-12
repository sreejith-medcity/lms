'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { getSessionUser, requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import { happened, notifyLearner } from '@/lib/events';
import { fromLocalInput, formatDateTime } from '@/lib/clock';
import { buildObjectKey, inferType, putObject, sanitiseFileName } from '@/lib/storage';
import {
  BRIEF_MAX_FILES,
  HAND_IN_MAX_FILES,
  HAND_IN_MAX_FILE_BYTES,
  HAND_IN_TEXT_MAX,
  gradeProblem,
  handInDecision,
  handInProblem,
  marksPercent,
  trimNumber,
} from '@/lib/assignment-rules';
import { enrolmentFor } from '@/lib/assignment-access';
import type { ActionState } from '@/server/courses';

/**
 * Homework, both ends of it.
 *
 * A trainer writes the brief and marks the hand-ins; a learner hands in.
 * The rules (may they hand in, is it late, is the mark inside the total)
 * live in assignment-rules and are applied here, so the page that greys
 * out the button and the action that refuses the post agree.
 *
 * Files are ordinary assets, private like everything else in the bucket:
 * the asset route lets the learner who handed a file in, and staff, read
 * it, and lets the learners an assignment was set for read its brief.
 */

const STAFF_KEY = 'courses.assessments';
const MARK_KEY = 'submission.evaluate_submissions';

async function staff(key: string, action: 'view' | 'edit' | 'delete' = 'edit') {
  const [tenant, user] = await Promise.all([requireTenant(), requireStaff(key, action)]);
  if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
  return { tenant, user };
}

async function learner() {
  const tenant = await requireTenant();
  const user = await getSessionUser();
  if (!user || user.organizationId !== tenant.organizationId) throw new Error('UNAUTHORIZED');
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  if (message === 'NOT_FOUND') return { error: 'That assignment is no longer here.' };
  console.error('[assignments]', message);
  return { error: 'Something went wrong. Please try again.' };
}

const on = (v: FormDataEntryValue | null) => v === 'on' || v === 'true' || v === '1';

/* Setting one ------------------------------------------------------------- */

const briefShape = z.object({
  id: z.string().trim().max(60).optional(),
  courseId: z.string().trim().min(1, 'Pick a course.'),
  batchId: z.string().trim().max(60).optional(),
  title: z.string().trim().min(2, 'Give the assignment a title.').max(160),
  instructions: z.string().trim().max(20_000).optional(),
  maxMarks: z.coerce.number().min(1, 'Marks out of at least 1.').max(10_000),
  dueAt: z.string().trim().optional(),
  status: z.enum(['DRAFT', 'PUBLISHED']),
});

export async function saveAssignment(_prev: ActionState, formData: FormData): Promise<ActionState & { id?: string }> {
  try {
    const { tenant, user } = await staff(STAFF_KEY, 'edit');
    const parsed = briefShape.safeParse({
      id: formData.get('id') || undefined,
      courseId: formData.get('courseId'),
      batchId: formData.get('batchId') || undefined,
      title: formData.get('title'),
      instructions: formData.get('instructions') || undefined,
      maxMarks: formData.get('maxMarks') || 100,
      dueAt: formData.get('dueAt') || undefined,
      status: formData.get('status') === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT',
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;

    const course = await db.course.findFirst({
      where: { id: d.courseId, organizationId: tenant.organizationId },
      select: { id: true, productId: true, product: { select: { title: true } } },
    });
    if (!course) return { error: 'That course is not one of yours.' };

    let batchId: string | null = null;
    if (d.batchId) {
      const batch = await db.batch.findFirst({
        where: { id: d.batchId, organizationId: tenant.organizationId, courseId: course.id, deletedAt: null },
        select: { id: true },
      });
      if (!batch) return { error: 'That batch does not belong to this course.' };
      batchId = batch.id;
    }

    const dueAt = d.dueAt ? fromLocalInput(d.dueAt, tenant.timezone) : null;
    if (d.dueAt && !dueAt) return { error: 'The due date could not be read.' };

    const data = {
      courseId: course.id,
      batchId,
      title: d.title,
      instructions: d.instructions ?? null,
      maxMarks: d.maxMarks,
      dueAt,
      acceptLate: on(formData.get('acceptLate')),
      allowResubmit: on(formData.get('allowResubmit')),
      requireText: on(formData.get('requireText')),
      requireFile: on(formData.get('requireFile')),
      status: d.status,
    };

    let id: string;
    let firstPublish = false;

    if (d.id) {
      id = d.id;
      const existing = await db.assignment.findFirst({
        where: { id, organizationId: tenant.organizationId, deletedAt: null },
        select: { id: true, publishedAt: true, courseId: true, submissions: { take: 1, select: { id: true } } },
      });
      if (!existing) throw new Error('NOT_FOUND');
      // Once anybody has handed in, the course it belongs to is fixed: moving
      // the homework would strand their work under a course they are not in.
      if (existing.submissions.length && existing.courseId !== course.id) {
        return { error: 'Work has already been handed in, so the course cannot be changed.' };
      }
      firstPublish = d.status === 'PUBLISHED' && !existing.publishedAt;
      await db.assignment.update({
        where: { id },
        data: { ...data, publishedAt: firstPublish ? new Date() : undefined },
      });
    } else {
      firstPublish = d.status === 'PUBLISHED';
      const created = await db.assignment.create({
        data: {
          organizationId: tenant.organizationId,
          createdById: user.id,
          publishedAt: firstPublish ? new Date() : null,
          ...data,
        },
        select: { id: true },
      });
      id = created.id;
    }

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: d.id ? 'assignment.updated' : 'assignment.created',
      entity: 'Assignment',
      entityId: id,
      after: { title: d.title, course: course.product.title, batchId, status: d.status, dueAt },
    });

    if (firstPublish) {
      await tellTheClass({
        organizationId: tenant.organizationId,
        assignmentId: id,
        title: d.title,
        courseId: course.id,
        productId: course.productId,
        courseTitle: course.product.title,
        batchId,
        dueAt,
        timezone: tenant.timezone,
      });
    }

    revalidatePath('/admin/assignments');
    revalidatePath(`/admin/assignments/${id}`);
    revalidatePath('/learn/assignments');
    return { ok: true, id, message: d.status === 'PUBLISHED' ? 'Saved and open to learners.' : 'Saved as a draft.' };
  } catch (err) {
    return fail(err);
  }
}

/**
 * The first time homework is published, every learner it was set for hears
 * about it. Once, not on every later edit: a corrected typo is not news.
 */
async function tellTheClass(input: {
  organizationId: string;
  assignmentId: string;
  title: string;
  courseId: string;
  productId: string;
  courseTitle: string;
  batchId: string | null;
  dueAt: Date | null;
  timezone: string;
}) {
  const learners = await db.enrollment.findMany({
    where: {
      organizationId: input.organizationId,
      status: { in: ['ENROLLED', 'ON_LEAVE'] },
      product: { course: { id: input.courseId } },
      ...(input.batchId ? { batchId: input.batchId } : {}),
    },
    select: { userId: true },
    distinct: ['userId'],
    take: 2000,
  });

  const due = input.dueAt ? `It is due ${formatDateTime(input.dueAt, input.timezone)}.` : 'There is no due date.';
  await happened({
    organizationId: input.organizationId,
    key: 'assignment.set',
    subjectId: input.assignmentId,
    productId: input.productId,
    batchId: input.batchId,
    data: { assignmentId: input.assignmentId, item: input.title, course: input.courseTitle, dueAt: input.dueAt, learners: learners.length },
  });
  for (const l of learners) {
    await notifyLearner({
      organizationId: input.organizationId,
      eventKey: 'assignment.set',
      userId: l.userId,
      subjectId: `${input.assignmentId}:${l.userId}`,
      context: { item: input.title, course: input.courseTitle, due, url: `/learn/assignments/${input.assignmentId}` },
    });
  }
}

export async function archiveAssignment(id: string): Promise<ActionState> {
  try {
    const { tenant, user } = await staff(STAFF_KEY, 'delete');
    const existing = await db.assignment.findFirst({ where: { id, organizationId: tenant.organizationId, deletedAt: null }, select: { id: true, title: true } });
    if (!existing) throw new Error('NOT_FOUND');
    await db.assignment.update({ where: { id }, data: { status: 'ARCHIVED', deletedAt: new Date() } });
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'assignment.archived', entity: 'Assignment', entityId: id, before: { title: existing.title } });
    revalidatePath('/admin/assignments');
    revalidatePath('/learn/assignments');
    return { ok: true, message: 'Archived. Learners no longer see it; their hand-ins are kept.' };
  } catch (err) {
    return fail(err);
  }
}

/* The brief's files ------------------------------------------------------- */

async function storeFiles(input: { organizationId: string; uploaderId: string; files: File[]; label: string }) {
  const ids: string[] = [];
  for (const file of input.files) {
    const fileName = sanitiseFileName(file.name || 'file');
    const key = buildObjectKey(input.organizationId, fileName);
    const mime = file.type || 'application/octet-stream';
    await putObject(key, new Uint8Array(await file.arrayBuffer()), mime);
    const asset = await db.asset.create({
      data: {
        organizationId: input.organizationId,
        name: `${input.label}: ${fileName}`,
        fileName,
        type: inferType(fileName),
        storageKey: key,
        mimeType: mime,
        sizeBytes: BigInt(file.size),
        uploadedById: input.uploaderId,
        transcodeStatus: 'READY',
      },
      select: { id: true },
    });
    ids.push(asset.id);
  }
  return ids;
}

function pickFiles(formData: FormData, field: string): File[] {
  return formData.getAll(field).filter((f): f is File => f instanceof File && f.size > 0);
}

export async function addBriefFiles(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await staff(STAFF_KEY, 'edit');
    const id = String(formData.get('assignmentId') ?? '');
    const assignment = await db.assignment.findFirst({
      where: { id, organizationId: tenant.organizationId, deletedAt: null },
      select: { id: true, title: true, _count: { select: { attachments: true } } },
    });
    if (!assignment) throw new Error('NOT_FOUND');

    const files = pickFiles(formData, 'files');
    if (!files.length) return { error: 'Pick a file first.' };
    if (assignment._count.attachments + files.length > BRIEF_MAX_FILES) return { error: `A brief can carry up to ${BRIEF_MAX_FILES} files.` };
    const big = files.find((f) => f.size > HAND_IN_MAX_FILE_BYTES);
    if (big) return { error: `${big.name} is over 25 MB. Put large videos in the media library and link them from the brief.` };

    const assetIds = await storeFiles({ organizationId: tenant.organizationId, uploaderId: user.id, files, label: `Brief for ${assignment.title}` });
    await db.assignmentAttachment.createMany({
      data: assetIds.map((assetId, i) => ({ assignmentId: id, assetId, sortOrder: assignment._count.attachments + i })),
      skipDuplicates: true,
    });
    revalidatePath(`/admin/assignments/${id}`);
    revalidatePath(`/learn/assignments/${id}`);
    return { ok: true, message: files.length === 1 ? 'File added.' : `${files.length} files added.` };
  } catch (err) {
    return fail(err);
  }
}

export async function removeBriefFile(assignmentId: string, assetId: string): Promise<ActionState> {
  try {
    const { tenant } = await staff(STAFF_KEY, 'edit');
    const assignment = await db.assignment.findFirst({ where: { id: assignmentId, organizationId: tenant.organizationId }, select: { id: true } });
    if (!assignment) throw new Error('NOT_FOUND');
    await db.assignmentAttachment.deleteMany({ where: { assignmentId, assetId } });
    revalidatePath(`/admin/assignments/${assignmentId}`);
    revalidatePath(`/learn/assignments/${assignmentId}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/* Handing in ---------------------------------------------------------------- */

export async function handIn(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await learner();
    const assignmentId = String(formData.get('assignmentId') ?? '');
    const assignment = await db.assignment.findFirst({
      where: { id: assignmentId, organizationId: tenant.organizationId, deletedAt: null },
      select: {
        id: true,
        title: true,
        courseId: true,
        batchId: true,
        status: true,
        dueAt: true,
        acceptLate: true,
        allowResubmit: true,
        requireText: true,
        requireFile: true,
        maxMarks: true,
        course: { select: { productId: true, product: { select: { title: true } } } },
      },
    });
    if (!assignment) throw new Error('NOT_FOUND');

    const enrolment = await enrolmentFor(tenant.organizationId, user.id, assignment);
    if (!enrolment) return { error: 'This assignment was not set for you.' };

    const prior = await db.assignmentSubmission.findMany({
      where: { assignmentId, userId: user.id, organizationId: tenant.organizationId },
      select: { attemptNo: true, status: true },
    });
    const decision = handInDecision(assignment, prior);
    if (!decision.allowed) return { error: decision.reason };

    const text = String(formData.get('text') ?? '').trim().slice(0, HAND_IN_TEXT_MAX);
    const files = pickFiles(formData, 'files');
    if (files.length > HAND_IN_MAX_FILES) return { error: `Up to ${HAND_IN_MAX_FILES} files per hand-in.` };
    const big = files.find((f) => f.size > HAND_IN_MAX_FILE_BYTES);
    if (big) return { error: `${big.name} is over 25 MB. Compress it, or split it.` };
    const problem = handInProblem(assignment, { text, fileCount: files.length });
    if (problem) return { error: problem };

    const assetIds = await storeFiles({ organizationId: tenant.organizationId, uploaderId: user.id, files, label: `Hand-in by ${user.name}` });

    const submission = await db.assignmentSubmission.create({
      data: {
        organizationId: tenant.organizationId,
        assignmentId,
        userId: user.id,
        enrollmentId: enrolment.id,
        attemptNo: decision.attemptNo,
        status: 'SUBMITTED',
        text: text || null,
        isLate: decision.late,
        files: { create: assetIds.map((assetId, i) => ({ assetId, sortOrder: i })) },
      },
      select: { id: true },
    });

    await happened({
      organizationId: tenant.organizationId,
      key: 'assignment.handed_in',
      userId: user.id,
      subjectId: submission.id,
      productId: enrolment.productId,
      batchId: enrolment.batchId,
      data: { assignmentId, submissionId: submission.id, item: assignment.title, attemptNo: decision.attemptNo, late: decision.late, files: assetIds.length },
    });

    revalidatePath('/learn/assignments');
    revalidatePath(`/learn/assignments/${assignmentId}`);
    revalidatePath('/admin/assignments');
    revalidatePath(`/admin/assignments/${assignmentId}`);
    return {
      ok: true,
      message: decision.late ? 'Handed in, after the due date. Your trainer will see it marked late.' : decision.again ? 'Handed in again.' : 'Handed in.',
    };
  } catch (err) {
    return fail(err);
  }
}

/* Marking ------------------------------------------------------------------- */

const gradeShape = z.object({
  submissionId: z.string().trim().min(1),
  decision: z.enum(['GRADE', 'RETURN']),
  marks: z.string().trim().optional(),
  feedback: z.string().trim().max(10_000).optional(),
});

export async function gradeHandIn(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await staff(MARK_KEY, 'edit');
    const parsed = gradeShape.safeParse({
      submissionId: formData.get('submissionId'),
      decision: formData.get('decision') === 'RETURN' ? 'RETURN' : 'GRADE',
      marks: formData.get('marks') ?? undefined,
      feedback: formData.get('feedback') || undefined,
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;

    const submission = await db.assignmentSubmission.findFirst({
      where: { id: d.submissionId, organizationId: tenant.organizationId },
      select: {
        id: true,
        userId: true,
        attemptNo: true,
        status: true,
        assignment: {
          select: {
            id: true,
            title: true,
            maxMarks: true,
            course: { select: { productId: true } },
          },
        },
      },
    });
    if (!submission) throw new Error('NOT_FOUND');

    // Only the latest attempt is marked. Marking an earlier one after a
    // resubmission would tell the learner two different things at once.
    const later = await db.assignmentSubmission.count({
      where: { organizationId: tenant.organizationId, assignmentId: submission.assignment.id, userId: submission.userId, attemptNo: { gt: submission.attemptNo } },
    });
    if (later > 0) return { error: 'The learner has handed in again since. Mark the latest hand-in.' };

    if (d.decision === 'RETURN') {
      if (!d.feedback) return { error: 'Say what needs another go before returning it.' };
      await db.assignmentSubmission.update({
        where: { id: submission.id },
        data: { status: 'RETURNED', marks: null, feedback: d.feedback, gradedAt: new Date(), gradedById: user.id },
      });
    } else {
      const marks = d.marks === undefined || d.marks === '' ? null : Number(d.marks);
      const problem = gradeProblem(marks, submission.assignment.maxMarks);
      if (problem) return { error: problem };
      await db.assignmentSubmission.update({
        where: { id: submission.id },
        data: { status: 'GRADED', marks: marks!, feedback: d.feedback ?? null, gradedAt: new Date(), gradedById: user.id },
      });
    }

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: d.decision === 'RETURN' ? 'assignment.returned' : 'assignment.graded',
      entity: 'AssignmentSubmission',
      entityId: submission.id,
      after: { marks: d.marks ?? null, learner: submission.userId },
    });

    const marks = d.decision === 'GRADE' ? Number(d.marks) : null;
    const percent = marks === null ? null : marksPercent(marks, submission.assignment.maxMarks);
    const score = marks === null ? 'returned for another go' : `${trimNumber(marks)} out of ${trimNumber(submission.assignment.maxMarks)}`;
    await happened({
      organizationId: tenant.organizationId,
      key: 'assignment.graded',
      userId: submission.userId,
      subjectId: submission.id,
      productId: submission.assignment.course.productId,
      data: {
        assignmentId: submission.assignment.id,
        submissionId: submission.id,
        item: submission.assignment.title,
        marks,
        maxMarks: submission.assignment.maxMarks,
        percent,
        returned: d.decision === 'RETURN',
        // Forty percent, the same line assessments draw by default.
        passed: percent !== null && percent >= 40,
      },
    });
    await notifyLearner({
      organizationId: tenant.organizationId,
      eventKey: 'assignment.graded',
      userId: submission.userId,
      subjectId: `${submission.id}:${d.decision}`,
      context: { item: submission.assignment.title, score, url: `/learn/assignments/${submission.assignment.id}` },
    });

    revalidatePath('/admin/assignments');
    revalidatePath(`/admin/assignments/${submission.assignment.id}`);
    revalidatePath(`/admin/assignments/${submission.assignment.id}/hand-ins/${submission.id}`);
    revalidatePath(`/learn/assignments/${submission.assignment.id}`);
    revalidatePath('/learn/assignments');
    return { ok: true, message: d.decision === 'RETURN' ? 'Returned to the learner.' : 'Marked.' };
  } catch (err) {
    return fail(err);
  }
}
