'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { evaluateAttemptWriting } from '@/lib/ai-marking';
import { announceMarked } from '@/lib/assessment-events';
import { assessmentAccess } from '@/lib/assessment-access';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { deadlineFor } from '@/lib/attempt-clock';
import { buildObjectKey, inferType, putObject, sanitiseFileName } from '@/lib/storage';
import { ANSWER_FILE_MAX_BYTES, SPEAKING_MAX_SECONDS, isHumanMarked, markAuto, readSectionClock, sectionState } from '@/lib/question-scoring';
import type { ActionState } from '@/server/courses';

/**
 * Sitting an assessment.
 *
 * The deadline is the server's. It is derived from the attempt's own startedAt
 * plus the assessment's duration, never sent up from the browser and never
 * trusted from it, so closing the laptop and coming back does not buy extra
 * time and neither does editing a clock. The client shows a countdown for the
 * learner's benefit; the server decides whether an answer arrived in time.
 *
 * Every answer is saved on its own as it is given. A dropped connection costs
 * the last answer, not the paper.
 */

async function entitled(assessmentId: string) {
  const tenant = await requireTenant();
  const user = await getSessionUser();
  if (!user) throw new Error('SIGN_IN_REQUIRED');

  const assessment = await db.assessment.findFirst({
    where: { id: assessmentId, organizationId: tenant.organizationId },
    include: { courses: { select: { courseId: true } } },
  });
  if (!assessment) throw new Error('NOT_FOUND');

  /*
   * Three ways a learner reaches a test: their course includes it, the
   * academy gave it to them, or it is in a set they hold an allowance for.
   * One resolver answers all three, so this and the page they came from
   * cannot disagree about whether they are allowed in. Staff preview
   * without any of it.
   */
  if (user.kind !== 'STAFF') {
    const access = await assessmentAccess({
      organizationId: tenant.organizationId,
      userId: user.id,
      assessmentId: assessment.id,
    });
    if (!access.entitled) throw new Error('NOT_ENROLLED');

    const enrolled = await db.enrollment.findFirst({
      where: {
        userId: user.id,
        organizationId: tenant.organizationId,
        status: { notIn: ['CANCELLED', 'ARCHIVED'] },
        ...(assessment.courses.length > 0
          ? { product: { course: { id: { in: assessment.courses.map((c) => c.courseId) } } } }
          : {}),
      },
      select: { id: true },
    });

    // A test given to somebody outside its course has no enrolment to hang
    // the attempt on, and that is allowed: the attempt stands on its own.
    return { tenant, user, assessment, enrollmentId: enrolled?.id ?? null, access };
  }

  return { tenant, user, assessment, enrollmentId: null as string | null, access: null };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'SIGN_IN_REQUIRED') return { error: 'Please sign in again.' };
  if (message === 'NOT_FOUND') return { error: 'That assessment is not available.' };
  if (message === 'NOT_AVAILABLE') return { error: 'This assessment is not attached to a course yet.' };
  if (message === 'NOT_ENROLLED') return { error: 'This assessment is not part of your enrolment.' };
  console.error('[attempts]', message);
  return { error: 'Something went wrong. Please try again.' };
}

/**
 * Starts an attempt, or hands back the one already in progress.
 *
 * Reconnecting must never burn an attempt, so an unsubmitted attempt inside its
 * window is resumed rather than replaced.
 */
export async function startAttempt(
  assessmentId: string,
): Promise<ActionState & { attemptId?: string }> {
  try {
    const { user, assessment, enrollmentId, access } = await entitled(assessmentId);

    const now = new Date();
    if (assessment.opensAt && assessment.opensAt > now) {
      return { error: `This opens on ${assessment.opensAt.toLocaleString('en-IN')}.` };
    }
    if (assessment.closesAt && assessment.closesAt < now) {
      return { error: 'This assessment has closed.' };
    }

    const existing = await db.attempt.findFirst({
      where: { assessmentId, userId: user.id, status: 'IN_PROGRESS' },
      orderBy: { attemptNo: 'desc' },
      select: { id: true, startedAt: true },
    });

    if (existing) {
      const { expired } = deadlineFor(existing.startedAt, assessment.durationMinutes);
      if (!expired) return { ok: true, attemptId: existing.id };

      // Time ran out while they were away. Close it honestly and score what is there.
      await submitAttempt(existing.id, true);
    }

    // The allowance, including anything the academy granted this learner.
    if (access && !access.canStart) {
      return { error: access.message ?? 'You have used every attempt at this test.' };
    }

    // Numbered from what exists rather than from the allowance, so a voided
    // attempt does not hand out a number already taken.
    const taken = await db.attempt.count({ where: { assessmentId, userId: user.id } });

    const created = await db.attempt.create({
      data: {
        assessmentId,
        userId: user.id,
        enrollmentId,
        attemptNo: taken + 1,
        status: 'IN_PROGRESS',
      },
      select: { id: true },
    });

    return { ok: true, attemptId: created.id };
  } catch (err) {
    return fail(err);
  }
}

/** One answer, saved as it is given. Refused once the deadline has passed. */
export async function saveAnswer(
  attemptId: string,
  questionId: string,
  response: unknown,
): Promise<ActionState & { expired?: boolean; sectionClosed?: boolean }> {
  try {
    const user = await getSessionUser();
    if (!user) return { error: 'Please sign in again.' };

    const attempt = await db.attempt.findFirst({
      where: { id: attemptId, userId: user.id },
      select: {
        id: true,
        status: true,
        startedAt: true,
        sectionClock: true,
        assessment: {
          select: {
            durationMinutes: true,
            questions: { where: { questionId }, select: { section: { select: { id: true, durationMinutes: true } } } },
          },
        },
        answers: { where: { questionId }, select: { id: true } },
      },
    });
    if (!attempt) return { error: 'Attempt not found.' };
    if (attempt.status !== 'IN_PROGRESS') return { error: 'This attempt is already submitted.' };
    if (attempt.assessment.questions.length === 0) return { error: 'That question is not on this paper.' };

    const { expired } = deadlineFor(attempt.startedAt, attempt.assessment.durationMinutes);
    if (expired) {
      await submitAttempt(attemptId, true);
      return { error: 'Time is up. Your paper has been submitted.', expired: true };
    }

    // A timed section takes answers only while its own clock runs.
    const section = attempt.assessment.questions[0].section;
    if (section?.durationMinutes) {
      const clock = readSectionClock(attempt.sectionClock);
      const state = sectionState({ id: section.id, durationMinutes: section.durationMinutes, startedAt: clock[section.id] ?? null });
      if (state === 'NOT_STARTED') return { error: 'Start the section before answering.' };
      if (state === 'CLOSED') return { error: 'This section has closed.', expired: false, sectionClosed: true };
    }

    await db.answer.upsert({
      where: { attemptId_questionId: { attemptId, questionId } },
      create: { attemptId, questionId, response: response as never },
      update: { response: response as never },
    });

    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Submits and scores.
 *
 * Objective questions are marked here and now. Written ones go to a grading
 * queue and the attempt stays SUBMITTED rather than EVALUATED, so a percentage
 * is never reported as final while a human still has to read half the paper.
 */
export async function submitAttempt(
  attemptId: string,
  auto = false,
): Promise<ActionState & { scorePercent?: number; awaitingMarking?: boolean }> {
  try {
    const attempt = await db.attempt.findUnique({
      where: { id: attemptId },
      include: {
        assessment: {
          select: {
            id: true,
            passPercent: true,
            durationMinutes: true,
            organizationId: true,
            questions: {
              select: {
                marks: true,
                question: {
                  select: {
                    id: true,
                    type: true,
                    marks: true,
                    negativeMarks: true,
                    answerKey: true,
                    options: { select: { id: true, isCorrect: true } },
                  },
                },
              },
            },
          },
        },
        answers: true,
      },
    });
    if (!attempt) return { error: 'Attempt not found.' };

    if (!auto) {
      const user = await getSessionUser();
      if (!user || user.id !== attempt.userId) return { error: 'Attempt not found.' };
    }
    if (attempt.status !== 'IN_PROGRESS') {
      return { ok: true, scorePercent: attempt.scorePercent ?? undefined };
    }

    const byQuestion = new Map(attempt.answers.map((a) => [a.questionId, a]));

    let awarded = 0;
    let objectiveTotal = 0;
    let paperTotal = 0;
    let needsMarking = false;

    const updates: { id: string; isCorrect: boolean | null; marksAwarded: number | null }[] = [];

    for (const item of attempt.assessment.questions) {
      const q = item.question;
      const marks = item.marks ?? q.marks;
      paperTotal += marks;

      const answer = byQuestion.get(q.id);

      if (isHumanMarked(q.type)) {
        needsMarking = true;
        continue;
      }

      objectiveTotal += marks;
      if (!answer) continue;

      // Choice, blanks, pairs and order are all marked in one place, with
      // the same rule for a blank answer: it costs nothing.
      const marked = markAuto({
        type: q.type,
        marks,
        negativeMarks: q.negativeMarks,
        options: q.options,
        answerKey: q.answerKey,
        response: answer.response,
      });
      awarded += marked.marksAwarded;
      updates.push({ id: answer.id, isCorrect: marked.isCorrect, marksAwarded: marked.marksAwarded });
    }

    const scoreBase = needsMarking ? objectiveTotal : paperTotal;
    const scorePercent = scoreBase > 0 ? Math.max(0, (awarded / scoreBase) * 100) : 0;

    await db.$transaction([
      ...updates.map((u) =>
        db.answer.update({
          where: { id: u.id },
          data: { isCorrect: u.isCorrect, marksAwarded: u.marksAwarded },
        }),
      ),
      db.attempt.update({
        where: { id: attemptId },
        data: {
          status: needsMarking ? 'SUBMITTED' : 'EVALUATED',
          submittedAt: new Date(),
          scoreRaw: awarded,
          scorePercent: needsMarking ? null : Math.round(scorePercent * 10) / 10,
          passed: needsMarking ? null : scorePercent >= attempt.assessment.passPercent,
        },
      }),
      ...(needsMarking
        ? [
            db.submission.upsert({
              where: { attemptId },
              create: { attemptId, userId: attempt.userId, status: 'NOT_EVALUATED' },
              update: {},
            }),
          ]
        : []),
    ]);

    // The AI examiner marks the written half now, where the academy has
    // switched it on. Not awaited: the learner sees "submitted" at once and
    // the mark lands a minute later; a model outage costs nothing but that.
    if (needsMarking) {
      evaluateAttemptWriting(attemptId).catch((err: unknown) =>
        console.error('[attempts] AI marking failed', err instanceof Error ? err.message : err),
      );
    }

    revalidatePath('/admin/submissions');
    return {
      ok: true,
      scorePercent: needsMarking ? undefined : Math.round(scorePercent * 10) / 10,
      awaitingMarking: needsMarking,
    };
  } catch (err) {
    return fail(err);
  }
}

/* Marking ----------------------------------------------------------------- */

/**
 * A trainer marking the written half. The objective marks already awarded are
 * kept and added to, so a paper is never re-scored from scratch by hand.
 */
export async function markSubmission(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const tenant = await requireTenant();
    const staff = await requireStaffFor('submission.evaluate_submissions');

    const attemptId = String(formData.get('attemptId') ?? '');
    const feedback = String(formData.get('feedback') ?? '').trim();

    const attempt = await db.attempt.findFirst({
      where: { id: attemptId, assessment: { organizationId: tenant.organizationId } },
      include: {
        answers: { include: { question: { select: { id: true, type: true, marks: true } } } },
        assessment: {
          select: {
            id: true,
            title: true,
            passPercent: true,
            questions: { select: { marks: true, question: { select: { id: true, marks: true } } } },
          },
        },
      },
    });
    if (!attempt) return { error: 'Attempt not found.' };

    let awarded = 0;
    const updates = [];

    for (const answer of attempt.answers) {
      const item = attempt.assessment.questions.find((q) => q.question.id === answer.question.id);
      const max = item?.marks ?? answer.question.marks;

      if (isHumanMarked(answer.question.type)) {
        const raw = formData.get(`marks:${answer.question.id}`);
        if (raw == null) continue;

        const given = Math.max(0, Math.min(max, Number(raw) || 0));
        awarded += given;
        updates.push(
          db.answer.update({
            where: { id: answer.id },
            data: { marksAwarded: given, evaluatedById: staff.id },
          }),
        );
      } else {
        awarded += answer.marksAwarded ?? 0;
      }
    }

    const paperTotal = attempt.assessment.questions.reduce(
      (n, q) => n + (q.marks ?? q.question.marks),
      0,
    );
    const scorePercent = paperTotal > 0 ? Math.max(0, (awarded / paperTotal) * 100) : 0;

    await db.$transaction([
      ...updates,
      db.attempt.update({
        where: { id: attemptId },
        data: {
          status: 'EVALUATED',
          scoreRaw: awarded,
          scorePercent: Math.round(scorePercent * 10) / 10,
          passed: scorePercent >= attempt.assessment.passPercent,
        },
      }),
      db.submission.update({
        where: { attemptId },
        data: {
          status: 'EVALUATED',
          evaluatedAt: new Date(),
          evaluatedById: staff.id,
          score: awarded,
          feedback: feedback || null,
        },
      }),
    ]);

    await announceMarked({
      organizationId: tenant.organizationId,
      attemptId,
      userId: attempt.userId,
      assessmentId: attempt.assessment.id,
      title: attempt.assessment.title,
      scorePercent: Math.round(scorePercent * 10) / 10,
      passed: scorePercent >= attempt.assessment.passPercent,
    });

    revalidatePath('/admin/submissions');
    return { ok: true, message: 'Marked. The learner can see it now.' };
  } catch (err) {
    return fail(err);
  }
}

async function requireStaffFor(permission: string) {
  const { requireStaff } = await import('@/lib/auth');
  return requireStaff(permission, 'edit');
}


/* Sections and uploads ----------------------------------------------------- */

/**
 * Opening a timed section starts its clock, once. A second press, or a
 * reload, finds the time already written and leaves it alone, so nobody
 * gets a fresh thirty minutes by refreshing.
 */
export async function startSection(attemptId: string, sectionId: string): Promise<ActionState & { startedAt?: string }> {
  try {
    const user = await getSessionUser();
    if (!user) return { error: 'Please sign in again.' };
    const attempt = await db.attempt.findFirst({
      where: { id: attemptId, userId: user.id, status: 'IN_PROGRESS' },
      select: { id: true, sectionClock: true, assessment: { select: { sections: { where: { id: sectionId }, select: { id: true, durationMinutes: true } } } } },
    });
    if (!attempt) return { error: 'Attempt not found.' };
    const section = attempt.assessment.sections[0];
    if (!section) return { error: 'Section not found.' };
    const clock = readSectionClock(attempt.sectionClock);
    if (clock[section.id]) return { ok: true, startedAt: clock[section.id].toISOString() };
    const now = new Date();
    await db.attempt.update({
      where: { id: attempt.id },
      data: { sectionClock: { ...Object.fromEntries(Object.entries(clock).map(([k, v]) => [k, v.toISOString()])), [section.id]: now.toISOString() } },
    });
    return { ok: true, startedAt: now.toISOString() };
  } catch (err) {
    return fail(err);
  }
}

/**
 * A file or a recording as the answer. Stored as the learner's own asset
 * and written into the answer as { assetId, fileName, ... }, through the
 * same gate as a typed answer so the deadline and the section clock hold.
 */
export async function uploadAnswer(
  attemptId: string,
  questionId: string,
  formData: FormData,
): Promise<ActionState & { expired?: boolean; sectionClosed?: boolean; answer?: { assetId: string; fileName: string; sizeBytes: number; durationSeconds?: number } }> {
  try {
    const user = await getSessionUser();
    if (!user) return { error: 'Please sign in again.' };
    const tenant = await requireTenant();
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) return { error: 'Nothing was attached.' };
    if (file.size > ANSWER_FILE_MAX_BYTES) return { error: 'Keep the file under 25 MB.' };
    const seconds = Number(formData.get('durationSeconds') ?? 0) || 0;
    if (seconds > SPEAKING_MAX_SECONDS + 5) return { error: 'A spoken answer is five minutes at most.' };

    const fileName = sanitiseFileName(file.name || 'answer');
    const key = buildObjectKey(tenant.organizationId, fileName);
    const mime = file.type || 'application/octet-stream';
    await putObject(key, new Uint8Array(await file.arrayBuffer()), mime);
    const asset = await db.asset.create({
      data: {
        organizationId: tenant.organizationId,
        name: `Answer by ${user.name}: ${fileName}`,
        fileName,
        type: seconds > 0 ? 'AUDIO' : inferType(fileName),
        storageKey: key,
        mimeType: mime,
        sizeBytes: BigInt(file.size),
        durationSeconds: seconds > 0 ? Math.round(seconds) : null,
        uploadedById: user.id,
        transcodeStatus: 'READY',
      },
      select: { id: true },
    });

    const answer = { assetId: asset.id, fileName, sizeBytes: file.size, ...(seconds > 0 ? { durationSeconds: Math.round(seconds) } : {}) };
    const saved = await saveAnswer(attemptId, questionId, answer);
    if (saved.error) return saved;
    return { ok: true, answer };
  } catch (err) {
    return fail(err);
  }
}
