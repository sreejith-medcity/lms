import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import {
  batches as edmingleBatches,
  certificateCourses,
  classAttendancePage,
  classReportPage,
  edmingleFor,
  learnerCertificateUrl,
  masterBatchDetail,
  sessions as edmingleSessions,
  tutors as edmingleTutors,
  type EdmingleClient,
  type EdmingleSession,
} from '@/lib/edmingle';
import { epochDate, normalisePhone } from '@/lib/edmingle-records';
import { migrated, mark, problem, report, sample, type EdmingleReport } from '@/lib/migrate-edmingle';
import { buildObjectKey, inferMimeType, putObject } from '@/lib/storage';

/**
 * The archive: what Edmingle knows about the years already taught.
 *
 * None of this is needed to run a class tomorrow, which is why it comes
 * last, after the courses, the people and the rolls. It is needed the day
 * a parent asks how many classes their child missed in March, a learner
 * asks for the mock test they sat in May, or an auditor asks who taught a
 * batch. Five steps, each keyed on Edmingle's own ids so a second run
 * finds the work done:
 *
 * - staff: every tutor becomes a staff account with the Instructor role
 *   and is put on the batches Edmingle had them on. Nobody gets a password.
 * - sessions: every class ever scheduled, held, cancelled or missed, under
 *   the batch it was held for, with who took it.
 * - attendance: each learner's mark for each session, read class by class.
 * - progress: every test a learner sat, with marks, as an archived test
 *   here; every lesson a learner opened, as lesson progress.
 * - certificates: the completion certificate Edmingle issued, pulled as a
 *   PDF and recorded against the enrolment it was earned on.
 */

const SOURCE = 'EDMINGLE';
const BUDGET_MS = 45_000;
const INSTRUCTOR_ROLE = 'Instructor';

type Target = Map<string, string | null>;

async function defaultBranch(organizationId: string): Promise<string | null> {
  const b = await db.branch.findFirst({ where: { organizationId, isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true } });
  return b?.id ?? null;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/* Step 9: staff ---------------------------------------------------------------- */

export async function importStaff(organizationId: string, options: { dryRun: boolean }): Promise<EdmingleReport> {
  const r = report('staff');
  const client = await edmingleFor(organizationId);
  if (!client) {
    problem(r, 'Edmingle is not connected.');
    return r;
  }
  const branchId = await defaultBranch(organizationId);
  if (!branchId) {
    problem(r, 'This academy has no active branch to put staff in.');
    return r;
  }
  let all;
  try {
    all = await edmingleTutors(client);
  } catch (err) {
    problem(r, message(err));
    return r;
  }
  const [done, doneAssignments, batchRows] = await Promise.all([
    migrated('staff'),
    migrated('batch-tutor'),
    db.migrationRecord.findMany({ where: { sourceSystem: SOURCE, entity: 'batch', status: 'MIGRATED' }, select: { sourceId: true, targetId: true } }),
  ]);
  const role = await db.role.findFirst({ where: { organizationId, name: INSTRUCTOR_ROLE }, select: { id: true } });
  if (!role && !options.dryRun) {
    problem(r, `The "${INSTRUCTOR_ROLE}" role is missing; open Settings, Roles once so the standard roles exist, then press again.`);
    return r;
  }
  const active = all.filter((t) => !Number(t.is_archived));
  r.looked = active.length;
  sample(r, `${active.length} people sign in to Edmingle's admin side (${all.length - active.length} archived, left out).`);

  for (const t of active) {
    const key = String(t.user_id);
    const email = (t.email ?? '').trim().toLowerCase();
    const name = (t.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 120) || `Tutor ${key}`;
    const admin = String(t.super_admin) === '1' || String(t.role) === '2';
    if (done.has(key)) {
      r.alreadyDone += 1;
      continue;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      problem(r, `${name} (${key}) has no email on Edmingle, so no staff account can be made; skipped.`);
      continue;
    }
    const existing = await db.user.findFirst({ where: { organizationId, email, deletedAt: null }, select: { id: true, kind: true } });
    if (existing && existing.kind === 'LEARNER') {
      problem(r, `${name}: ${email} belongs to a learner account here, so the tutor was not made. Give them a staff address and add them under Team.`);
      continue;
    }
    if (existing) {
      r.wouldUpdate += 1;
      if (options.dryRun) sample(r, `link: ${name} (already on the team here)`);
      else {
        await db.user.update({ where: { id: existing.id }, data: { legacyEdmingleId: key } });
        await db.instructorProfile.upsert({ where: { userId: existing.id }, create: { userId: existing.id }, update: {} });
        await mark('staff', key, existing.id, { linked: true, admin });
        done.set(key, existing.id);
      }
      continue;
    }
    r.wouldCreate += 1;
    if (options.dryRun) {
      sample(r, `new: ${name}${admin ? ' (an Edmingle admin: arrives as Instructor, promote by hand)' : ''}`);
      continue;
    }
    try {
      const phone = normalisePhone(t.contact_number, t.contact_number_dial_code);
      const phoneTaken = phone ? await db.user.findFirst({ where: { organizationId, phone }, select: { id: true } }) : null;
      const created = await db.user.create({
        data: {
          organizationId,
          name,
          email,
          phone: phoneTaken ? null : phone,
          kind: 'STAFF',
          status: 'ACTIVE',
          mustResetPassword: true,
          legacyEdmingleId: key,
          createdAt: epochDate(t.date_user_added) ?? undefined,
          roleAssignments: { create: { roleId: role!.id } },
          branchMemberships: { create: { branchId, isPrimary: true } },
          instructorProfile: { create: {} },
        },
        select: { id: true },
      });
      await mark('staff', key, created.id, { name, admin });
      done.set(key, created.id);
      if (admin) problem(r, `${name} is an admin on Edmingle and arrives here as an Instructor: promote them under Team if they should run the office.`);
    } catch (err) {
      problem(r, `${name}: ${message(err)}`);
    }
  }

  // Who teaches which batch, from the batch list's tutor column.
  if (batchRows.length > 0) {
    let list;
    try {
      list = await edmingleBatches(client);
    } catch (err) {
      problem(r, `Batch tutors not read: ${message(err)}`);
      return r;
    }
    const batchTarget = new Map(batchRows.map((b) => [b.sourceId, b.targetId]));
    for (const { batch } of list) {
      const bKey = String(batch.class_id);
      const batchId = batchTarget.get(bKey);
      const tutorId = batch.tutor_id ? done.get(String(batch.tutor_id)) : null;
      if (!batchId || !tutorId) continue;
      if (doneAssignments.has(bKey)) {
        r.alreadyDone += 1;
        continue;
      }
      r.wouldCreate += 1;
      if (options.dryRun) {
        if (r.samples.length < 8) sample(r, `${batch.tutor_name ?? batch.tutor_id} teaches ${batch.class_name}`);
        continue;
      }
      try {
        await db.batchStaff.upsert({
          where: { batchId_userId_role: { batchId, userId: tutorId, role: 'PRIMARY_TUTOR' } },
          create: { batchId, userId: tutorId, role: 'PRIMARY_TUTOR', startsOn: epochDate(batch.start_date), note: 'From Edmingle' },
          update: {},
        });
        await mark('batch-tutor', bKey, tutorId);
      } catch (err) {
        problem(r, `${batch.class_name}: tutor not assigned (${message(err)})`);
      }
    }
  }
  return r;
}

/* Step 10: sessions -------------------------------------------------------------- */

function sessionState(s: EdmingleSession, now: number): { status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED'; register: boolean } {
  const marked = (num(s.total_present) ?? 0) + (num(s.total_absent) ?? 0) > 0;
  const past = (s.gmt_start_time ?? 0) < now;
  if (s.status === 3) return { status: 'CANCELLED', register: false };
  if (s.status === 1 || s.status === 5 || marked) return { status: 'COMPLETED', register: marked };
  return { status: past ? 'COMPLETED' : 'SCHEDULED', register: false };
}

export async function importSessions(organizationId: string, options: { dryRun: boolean; budgetMs?: number }): Promise<EdmingleReport> {
  const r = report('sessions');
  const client = await edmingleFor(organizationId);
  if (!client) {
    problem(r, 'Edmingle is not connected.');
    return r;
  }
  const started = Date.now();
  const budget = options.budgetMs ?? BUDGET_MS;
  let all;
  try {
    all = await edmingleSessions(client);
  } catch (err) {
    problem(r, message(err));
    return r;
  }
  const [done, batchTarget, staffTarget] = await Promise.all([migrated('session'), migrated('batch'), migrated('staff')]);
  r.looked = all.length;
  const now = Math.floor(Date.now() / 1000);
  let noBatch = 0;
  let processed = 0;
  const pending = all.filter((s) => !done.has(String(s.id)));
  r.alreadyDone = all.length - pending.length;
  sample(r, `${all.length} sessions on Edmingle's calendar, past and future.`);

  for (const s of pending) {
    if (Date.now() - started > budget) break;
    processed += 1;
    const mbId = String(s.master_batch_ids ?? '').split(',')[0].trim();
    const batchId = mbId ? batchTarget.get(mbId) : null;
    if (!batchId) {
      noBatch += 1;
      continue;
    }
    const startsAt = epochDate(s.gmt_start_time);
    const endsAt = epochDate(s.gmt_end_time) ?? (startsAt ? new Date(startsAt.getTime() + 60 * 60_000) : null);
    if (!startsAt || !endsAt) {
      problem(r, `Session ${s.id} (${s.class_name ?? ''}) has no time on it; skipped.`);
      continue;
    }
    const state = sessionState(s, now);
    const title = (s.class_name ?? s.master_batch_names ?? 'Class').trim().slice(0, 200) || 'Class';
    const topics = [s.topics_taught, s.homework ? `Homework: ${s.homework}` : ''].map((x) => (x ?? '').trim()).filter(Boolean).join('\n').slice(0, 2000) || null;
    const tutorId = s.taken_by ? staffTarget.get(String(s.taken_by)) ?? null : null;
    r.wouldCreate += 1;
    if (options.dryRun) {
      if (r.samples.length < 8) sample(r, `${startsAt.toISOString().slice(0, 10)} ${title} [${state.status.toLowerCase()}${state.register ? ', register taken' : ''}]`);
      continue;
    }
    try {
      const created = await db.liveSession.create({
        data: {
          organizationId,
          batchId,
          title,
          topics,
          startsAt,
          endsAt,
          status: state.status,
          provider: (s.virtual_class_type ?? 0) > 0 ? 'ZOOM' : 'NATIVE',
          autoRecord: false,
          cancelledAt: state.status === 'CANCELLED' ? epochDate(s.taken_at) ?? startsAt : null,
          registerSubmittedAt: state.register ? epochDate(s.taken_at) ?? startsAt : null,
          registerSubmittedById: state.register ? tutorId : null,
          createdAt: epochDate(s.taken_at) ?? startsAt,
          instructors: tutorId ? { create: { userId: tutorId, isPrimary: true } } : undefined,
        },
        select: { id: true },
      });
      await mark('session', String(s.id), created.id, { classId: s.class_id, masterBatch: mbId, status: state.status });
    } catch (err) {
      problem(r, `Session ${s.id} (${title}): ${message(err)}`);
    }
  }
  if (noBatch) problem(r, `${noBatch} sessions belong to batches that have not come across (or to none), so they wait for the batches step.`);
  r.remaining = Math.max(0, pending.length - processed);
  if (r.remaining) sample(r, `${r.remaining} sessions still to write: press again.`);
  return r;
}

/* The teaching classes under each batch ----------------------------------------- */

/**
 * Edmingle hangs sessions, attendance and marks off the class (one per
 * module a batch teaches), not off the batch. The class ids are read once
 * per batch from the batch detail and kept on a record, so the two steps
 * that need them do not pay for the call twice.
 */
async function classesOfBatches(client: EdmingleClient, r: EdmingleReport, budgetLeft: () => number): Promise<{ classId: number; batchSource: string; batchId: string }[]> {
  const [batchRows, known] = await Promise.all([
    db.migrationRecord.findMany({ where: { sourceSystem: SOURCE, entity: 'batch', status: 'MIGRATED' }, select: { sourceId: true, targetId: true } }),
    db.migrationRecord.findMany({ where: { sourceSystem: SOURCE, entity: 'batch-classes', status: 'MIGRATED' }, select: { sourceId: true, payload: true } }),
  ]);
  const cached = new Map(known.map((k) => [k.sourceId, ((k.payload ?? {}) as { classIds?: number[] }).classIds ?? []]));
  const out: { classId: number; batchSource: string; batchId: string }[] = [];
  for (const b of batchRows) {
    if (!b.targetId) continue;
    let ids = cached.get(b.sourceId);
    if (!ids) {
      if (budgetLeft() < 8_000) break;
      try {
        const detail = await masterBatchDetail(client, Number(b.sourceId));
        ids = (detail?.courses_array ?? []).map((c) => c.class_id).filter((n) => Number.isFinite(n));
        await mark('batch-classes', b.sourceId, b.targetId, { classIds: ids });
      } catch (err) {
        problem(r, `Batch ${b.sourceId}: its classes were not read (${message(err)})`);
        continue;
      }
    }
    for (const classId of ids) out.push({ classId, batchSource: b.sourceId, batchId: b.targetId });
  }
  return out;
}

/* Step 11: attendance ------------------------------------------------------------ */

export async function importAttendance(organizationId: string, options: { dryRun: boolean; budgetMs?: number }): Promise<EdmingleReport> {
  const r = report('attendance');
  const client = await edmingleFor(organizationId);
  if (!client) {
    problem(r, 'Edmingle is not connected.');
    return r;
  }
  const started = Date.now();
  const budget = options.budgetMs ?? BUDGET_MS;
  const left = () => budget - (Date.now() - started);
  const classes = await classesOfBatches(client, r, left);
  const [doneClasses, sessionTarget, learnerTarget] = await Promise.all([migrated('class-attendance'), migrated('session'), migrated('learner')]);
  const pending = classes.filter((c) => !doneClasses.has(String(c.classId)));
  r.looked = classes.length;
  r.alreadyDone = classes.length - pending.length;
  if (pending.length === 0) {
    sample(r, classes.length ? 'Every class register has been read.' : 'No batches have come across yet, so there is nothing to read.');
    return r;
  }
  let processed = 0;
  let unknownLearners = 0;
  let unknownSessions = 0;
  for (const c of pending) {
    if (left() < 8_000) break;
    if (options.dryRun && processed >= 2) break;
    let complete = true;
    let rows: Prisma.AttendanceCreateManyInput[] = [];
    for (let page = 1; page <= 200; page += 1) {
      if (left() < 4_000) {
        complete = false;
        break;
      }
      let got;
      try {
        got = await classAttendancePage(client, c.classId, page);
      } catch (err) {
        problem(r, `Class ${c.classId} page ${page}: ${message(err)}`);
        complete = false;
        break;
      }
      if (page === 1 && got.sessionIds.length === 0) break;
      for (const learner of got.learners) {
        const userId = learnerTarget.get(String(learner.user_id));
        if (!userId) {
          unknownLearners += 1;
          continue;
        }
        for (const cell of Object.values(learner.learner_attendance ?? {})) {
          const sessionId = sessionTarget.get(String(cell.attendance_id));
          if (!sessionId) {
            unknownSessions += 1;
            complete = false;
            continue;
          }
          if (cell.status !== 0 && cell.status !== 1) continue;
          rows.push({ sessionId, userId, status: cell.status === 1 ? 'PRESENT' : 'ABSENT', source: 'REGISTER', wasInTime: cell.status === 1, recordedAt: epochDate(cell.date) ?? new Date() });
        }
      }
      if (!got.more) break;
    }
    r.wouldCreate += rows.length;
    if (options.dryRun) {
      sample(r, `class ${c.classId}: ${rows.length} marks across ${new Set(rows.map((x) => x.sessionId)).size} sessions`);
      processed += 1;
      continue;
    }
    try {
      for (let i = 0; i < rows.length; i += 500) await db.attendance.createMany({ data: rows.slice(i, i + 500), skipDuplicates: true });
      rows = [];
      if (complete) await mark('class-attendance', String(c.classId), c.batchId);
      processed += 1;
    } catch (err) {
      problem(r, `Class ${c.classId}: ${message(err)}`);
    }
  }
  if (unknownLearners) problem(r, `${unknownLearners} marks belong to learners not here (left Edmingle before the roll was read); skipped.`);
  if (unknownSessions) problem(r, `${unknownSessions} marks belong to sessions not here yet: run the sessions step to the end, then press again.`);
  r.remaining = Math.max(0, pending.length - processed);
  if (r.remaining) sample(r, options.dryRun ? `${r.remaining} more classes on the real run (a rehearsal samples two).` : `${r.remaining} classes still to read: press again.`);
  return r;
}

/* Step 12: progress and marks ------------------------------------------------------- */

interface QuizPayload {
  name: string;
  classId: number;
}

async function archivedAssessment(organizationId: string, quizTarget: Target, id: string, name: string, kind: 'TEST' | 'ASSIGNMENT' | 'MOCK_EXAM', classId: number): Promise<string> {
  const have = quizTarget.get(id);
  if (have) return have;
  const created = await db.assessment.create({
    data: {
      organizationId,
      title: name.slice(0, 200) || `Edmingle test ${id}`,
      kind,
      category: 'Edmingle archive',
      instructions: 'Sat on Edmingle before the move. The marks are here; the paper itself stayed behind.',
      maxAttempts: 0,
      opensAt: new Date(0),
      closesAt: new Date(0),
      showResultsImmediately: false,
    },
    select: { id: true },
  });
  const payload: QuizPayload = { name, classId };
  await mark('quiz', id, created.id, payload as unknown as Prisma.InputJsonValue);
  quizTarget.set(id, created.id);
  return created.id;
}

export async function importProgress(organizationId: string, options: { dryRun: boolean; budgetMs?: number }): Promise<EdmingleReport> {
  const r = report('progress');
  const client = await edmingleFor(organizationId);
  if (!client) {
    problem(r, 'Edmingle is not connected.');
    return r;
  }
  const started = Date.now();
  const budget = options.budgetMs ?? BUDGET_MS;
  const left = () => budget - (Date.now() - started);
  const classes = await classesOfBatches(client, r, left);
  const [doneClasses, learnerTarget, materialTarget, quizTarget] = await Promise.all([migrated('class-progress'), migrated('learner'), migrated('material'), migrated('quiz')]);
  const pending = classes.filter((c) => !doneClasses.has(String(c.classId)));
  r.looked = classes.length;
  r.alreadyDone = classes.length - pending.length;
  if (pending.length === 0) {
    sample(r, classes.length ? 'Every class report has been read.' : 'No batches have come across yet, so there is nothing to read.');
    return r;
  }
  let processed = 0;
  let unknownLearners = 0;
  let unknownLessons = 0;

  for (const c of pending) {
    if (left() < 10_000) break;
    if (options.dryRun && processed >= 2) break;
    const enrolments = new Map((await db.enrollment.findMany({ where: { organizationId, batchId: c.batchId }, select: { id: true, userId: true } })).map((e) => [e.userId, e.id]));
    // Edmingle's report carries no date per attempt, so the batch's own
    // dates stand in: a result is dated to when the batch ended, or began.
    const batch = await db.batch.findFirst({ where: { id: c.batchId, organizationId }, select: { startDate: true, endDate: true } });
    const satAt = batch?.endDate ?? batch?.startDate ?? new Date();
    let complete = true;
    let marks = 0;
    let lessons = 0;

    // The tests, with each learner's marks.
    for (let page = 1; page <= 200; page += 1) {
      if (left() < 4_000) {
        complete = false;
        break;
      }
      let got;
      try {
        got = await classReportPage(client, c.classId, page, false);
      } catch (err) {
        problem(r, `Class ${c.classId} marks page ${page}: ${message(err)}`);
        complete = false;
        break;
      }
      const tests = got.columns.map((col, i) => ({ col, i })).filter(({ col }) => col.kind !== -1 && col.kind !== 4 && col.id && col.id !== '-1');
      if (tests.length === 0) break;
      const attempts: Prisma.AttemptCreateManyInput[] = [];
      for (const learner of got.learners) {
        const userId = learnerTarget.get(String(learner.user_id));
        if (!userId) {
          unknownLearners += 1;
          continue;
        }
        for (const { col, i } of tests) {
          const m = learner.marks[i];
          if (!m) continue;
          const tries = num(m.no_of_attempts) ?? 0;
          const score = num(m.marks);
          if (tries <= 0 && score === null) continue;
          marks += 1;
          if (options.dryRun) continue;
          const kind = m.exercise_id ? 'ASSIGNMENT' : /mock/i.test(col.name) ? 'MOCK_EXAM' : 'TEST';
          const assessmentId = await archivedAssessment(organizationId, quizTarget, col.id, col.name, kind, c.classId);
          const total = num(m.total_marks);
          const percent = num(m.grade) ?? (score !== null && total ? Math.round((score / total) * 1000) / 10 : null);
          attempts.push({
            assessmentId,
            userId,
            enrollmentId: enrolments.get(userId) ?? null,
            attemptNo: 1,
            status: 'EVALUATED',
            startedAt: satAt,
            submittedAt: satAt,
            scoreRaw: score,
            scorePercent: percent,
            passed: m.passed === null || m.passed === undefined || m.passed === '' ? null : String(m.passed) === '1',
          });
        }
      }
      if (attempts.length) for (let i = 0; i < attempts.length; i += 500) await db.attempt.createMany({ data: attempts.slice(i, i + 500), skipDuplicates: true });
      if (!got.more) break;
    }

    // The lessons, with how many times each learner opened them.
    for (let page = 1; page <= 200; page += 1) {
      if (left() < 4_000) {
        complete = false;
        break;
      }
      let got;
      try {
        got = await classReportPage(client, c.classId, page, true);
      } catch (err) {
        problem(r, `Class ${c.classId} lessons page ${page}: ${message(err)}`);
        complete = false;
        break;
      }
      const cols = got.columns.map((col, i) => ({ materialId: col.kind === 4 ? materialTarget.get(col.id) ?? null : null, known: col.kind === 4, i }));
      if (page === 1) unknownLessons += cols.filter((x) => x.known && !x.materialId).length;
      if (!cols.some((x) => x.materialId)) break;
      const rows: Prisma.MaterialProgressCreateManyInput[] = [];
      const seenAt = new Date();
      for (const learner of got.learners) {
        const userId = learnerTarget.get(String(learner.user_id));
        if (!userId) continue;
        for (const { materialId, i } of cols) {
          if (!materialId) continue;
          const m = learner.marks[i];
          if (!m || (num(m.no_of_attempts) ?? 0) <= 0) continue;
          lessons += 1;
          if (options.dryRun) continue;
          rows.push({ userId, materialId, enrollmentId: enrolments.get(userId) ?? null, percent: 100, completedAt: seenAt, lastViewedAt: seenAt });
        }
      }
      if (rows.length) for (let i = 0; i < rows.length; i += 500) await db.materialProgress.createMany({ data: rows.slice(i, i + 500), skipDuplicates: true });
      if (!got.more) break;
    }

    r.wouldCreate += marks + lessons;
    if (r.samples.length < 8) sample(r, `class ${c.classId}: ${marks} test results, ${lessons} lessons opened`);
    if (!options.dryRun && complete) await mark('class-progress', String(c.classId), c.batchId);
    processed += 1;
  }
  if (unknownLearners) problem(r, `${unknownLearners} results belong to learners not here; skipped.`);
  if (unknownLessons) problem(r, `${unknownLessons} lessons in the reports are not in the library here (the catalogue step has not reached them, or they were deleted on Edmingle); their progress was skipped.`);
  r.remaining = Math.max(0, pending.length - processed);
  if (r.remaining) sample(r, options.dryRun ? `${r.remaining} more classes on the real run (a rehearsal samples two).` : `${r.remaining} classes still to read: press again.`);
  return r;
}

/* Step 13: certificates --------------------------------------------------------------- */

async function certificateTemplate(organizationId: string, name: string): Promise<string> {
  const have = await db.certificateTemplate.findFirst({ where: { organizationId, serialPrefix: 'EDM' }, select: { id: true } });
  if (have) return have.id;
  const created = await db.certificateTemplate.create({
    data: {
      organizationId,
      name: `${name} (issued on Edmingle)`.slice(0, 200),
      description: 'Certificates learners earned before the move. The PDF is the one Edmingle issued; new certificates come from a template of this academy.',
      serialPrefix: 'EDM',
      designJson: { archived: true },
      autoIssueOn: 'MANUAL',
    },
    select: { id: true },
  });
  return created.id;
}

export async function importCertificates(organizationId: string, options: { dryRun: boolean; budgetMs?: number }): Promise<EdmingleReport> {
  const r = report('certificates');
  const client = await edmingleFor(organizationId);
  if (!client) {
    problem(r, 'Edmingle is not connected.');
    return r;
  }
  const started = Date.now();
  const budget = options.budgetMs ?? BUDGET_MS;
  const left = () => budget - (Date.now() - started);

  let templates;
  try {
    templates = await certificateCourses(client);
  } catch (err) {
    problem(r, message(err));
    return r;
  }
  const bundleIds = new Set(templates.flatMap((t) => t.bundleIds.map(String)));
  if (bundleIds.size === 0) {
    sample(r, 'Edmingle issues no automatic certificate on any course, so there is nothing to bring.');
    return r;
  }
  const courseTarget = await migrated('course');
  const productIds = [...bundleIds].map((b) => courseTarget.get(b)).filter((x): x is string => Boolean(x));
  if (productIds.length === 0) {
    problem(r, 'The certified courses have not come across yet: run the catalogue step first.');
    return r;
  }
  // Only a learner who finished a certified course can have one.
  const candidates = await db.enrollment.findMany({
    where: { organizationId, productId: { in: productIds }, OR: [{ status: 'COMPLETED' }, { progressPercent: { gte: 100 } }], user: { legacyEdmingleId: { not: null } } },
    select: { id: true, userId: true, user: { select: { legacyEdmingleId: true, name: true } } },
  });
  const done = await migrated('certificate');
  const byUser = new Map<string, { enrollmentId: string; userId: string; name: string }>();
  for (const e of candidates) if (e.user.legacyEdmingleId && !byUser.has(e.user.legacyEdmingleId)) byUser.set(e.user.legacyEdmingleId, { enrollmentId: e.id, userId: e.userId, name: e.user.name });
  const pending = [...byUser.entries()].filter(([edmingleId]) => !done.has(edmingleId));
  r.looked = byUser.size;
  r.alreadyDone = byUser.size - pending.length;
  sample(r, `${byUser.size} learners finished a certified course (${templates.map((t) => t.name).join(', ')}).`);
  if (pending.length === 0) return r;

  let processed = 0;
  let templateId: string | null = null;
  for (const [edmingleId, who] of pending) {
    if (left() < 8_000) break;
    if (options.dryRun && processed >= 3) break;
    processed += 1;
    let url: string | null;
    try {
      url = await learnerCertificateUrl(client, Number(edmingleId));
    } catch (err) {
      problem(r, `${who.name}: ${message(err)}`);
      continue;
    }
    if (!url) {
      if (!options.dryRun) await mark('certificate', edmingleId, null, { none: true });
      continue;
    }
    r.wouldCreate += 1;
    if (options.dryRun) {
      sample(r, `${who.name}: certificate PDF found`);
      continue;
    }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`certificate download answered ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength > 15 * 1024 * 1024) throw new Error('certificate file too large');
      const fileName = `edmingle-certificate-${edmingleId}.pdf`;
      const key = buildObjectKey(organizationId, fileName);
      const mime = res.headers.get('content-type')?.split(';')[0] || inferMimeType(fileName);
      await putObject(key, bytes, mime);
      const asset = await db.asset.create({
        data: { organizationId, name: `Certificate: ${who.name}`.slice(0, 200), fileName, type: 'PDF', storageKey: key, mimeType: mime, sizeBytes: BigInt(bytes.byteLength), transcodeStatus: 'READY' },
        select: { id: true },
      });
      templateId ??= await certificateTemplate(organizationId, templates[0].name);
      const issued = await db.issuedCertificate.create({
        data: { templateId, userId: who.userId, enrollmentId: who.enrollmentId, serialNo: `EDM-${edmingleId}`, pdfAssetId: asset.id },
        select: { id: true },
      });
      await mark('certificate', edmingleId, issued.id, { assetId: asset.id, bytes: bytes.byteLength });
      if (r.samples.length < 8) sample(r, `${who.name}: certificate kept (${Math.round(bytes.byteLength / 1024)} KB)`);
    } catch (err) {
      problem(r, `${who.name}: ${message(err)}`);
    }
  }
  r.remaining = Math.max(0, pending.length - processed);
  if (r.remaining) sample(r, options.dryRun ? `${r.remaining} more learners to check on the real run (a rehearsal samples three).` : `${r.remaining} learners still to check: press again.`);
  return r;
}
