/**
 * The pilot: sample people and data for the sixteen acceptance checks.
 *
 * Two physical branches and the virtual one, three programs, a teacher
 * assigned across two branches, siblings on one parent, an adult learner,
 * two weeks of classes with attendance, a published and a submitted mark
 * sheet, open and overdue instalments, and a draft notice. Every row is
 * upserted by a stable key, so the script runs again without doubling.
 * Nothing is sent: attendance and marks are written directly, not through
 * the alerting paths, so the pilot starts with a clean inbox.
 *
 * Run: npx tsx prisma/pilot.ts            (the medcity organisation)
 *      PILOT_ORG=<slug> npx tsx prisma/pilot.ts
 * Sign-ins: every pilot staff member has the password in PILOT_PASSWORD
 * (default "Pilot#2026"); parents sign in with a code sent to the contact.
 */
import { PrismaClient, type $Enums } from '@prisma/client';
import { STANDARD_ROLES, roleGrants } from '../src/lib/standard-roles';
import { hashPassword } from '../src/lib/password';

const db = new PrismaClient();
const ORG = process.env.PILOT_ORG ?? 'medcity';
const PASSWORD = process.env.PILOT_PASSWORD ?? 'Pilot#2026';
const DAY = 864e5;

function at(daysFromNow: number, hour: number, minute = 0): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  // Kerala is UTC+5:30; a 10:00 class is 04:30Z.
  return new Date(d.getTime() + daysFromNow * DAY + (hour * 60 + minute - 330) * 60_000);
}

async function main() {
  const org = await db.organization.findUnique({ where: { slug: ORG }, select: { id: true, name: true } });
  if (!org) throw new Error(`No organisation with slug "${ORG}". Run npm run db:seed first.`);
  const orgId = org.id;
  console.log(`Pilot data for ${org.name}`);

  /* Roles ------------------------------------------------------------------ */
  const allPerms = await db.permission.findMany();
  const roles = new Map<string, string>();
  for (const def of STANDARD_ROLES) {
    const role = await db.role.upsert({
      where: { organizationId_name: { organizationId: orgId, name: def.name } },
      create: { organizationId: orgId, name: def.name, description: def.description, isSystem: true, restrictBatchAccess: def.restrictBatch, restrictBranchAccess: def.restrictBranch },
      update: {},
    });
    roles.set(def.name, role.id);
    for (const perm of allPerms) {
      const grant = roleGrants(def, perm.key);
      if (!grant) continue;
      await db.rolePermission.upsert({ where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } }, create: { roleId: role.id, permissionId: perm.id, ...grant }, update: {} });
    }
  }

  /* Branches --------------------------------------------------------------- */
  const branchDefs: { code: string; name: string; kind: $Enums.BranchKind; city: string }[] = [
    { code: 'PKOC', name: 'Pilot Kochi', kind: 'PHYSICAL', city: 'Kochi' },
    { code: 'PKZD', name: 'Pilot Kozhikode', kind: 'PHYSICAL', city: 'Kozhikode' },
    { code: 'PONL', name: 'Pilot Online', kind: 'VIRTUAL', city: 'Online' },
  ];
  const branches = new Map<string, string>();
  for (const b of branchDefs) {
    const row = await db.branch.upsert({
      where: { organizationId_code: { organizationId: orgId, code: b.code } },
      create: { organizationId: orgId, code: b.code, name: b.name, kind: b.kind, city: b.city, state: 'Kerala' },
      update: { kind: b.kind },
    });
    branches.set(b.code, row.id);
  }

  /* Staff ------------------------------------------------------------------ */
  const passwordHash = await hashPassword(PASSWORD);
  async function staff(email: string, name: string, role: string, branchCodes: string[]): Promise<string> {
    const user = await db.user.upsert({
      where: { organizationId_email: { organizationId: orgId, email } },
      create: { organizationId: orgId, email, name, kind: 'STAFF', status: 'ACTIVE', passwordHash, emailVerifiedAt: new Date() },
      update: { kind: 'STAFF', status: 'ACTIVE', passwordHash, deletedAt: null },
    });
    await db.userRole.deleteMany({ where: { userId: user.id } });
    await db.userRole.create({ data: { userId: user.id, roleId: roles.get(role)! } });
    await db.branchMembership.deleteMany({ where: { userId: user.id } });
    for (const [i, code] of branchCodes.entries()) {
      await db.branchMembership.create({ data: { userId: user.id, branchId: branches.get(code)!, isPrimary: i === 0 } });
    }
    return user.id;
  }
  const headKochi = await staff('pilot.head.kochi@medcitylms.in', 'Pilot Head, Kochi', 'Branch Head', ['PKOC']);
  const headKzd = await staff('pilot.head.kozhikode@medcitylms.in', 'Pilot Head, Kozhikode', 'Branch Head', ['PKZD']);
  const headOnline = await staff('pilot.head.online@medcitylms.in', 'Pilot Head, Online', 'Branch Head', ['PONL']);
  const academic = await staff('pilot.academic@medcitylms.in', 'Pilot Academic Manager', 'Academic Manager', ['PKOC', 'PKZD']);
  const teacherAcross = await staff('pilot.teacher.across@medcitylms.in', 'Pilot Teacher (Kochi and Online)', 'Teacher', ['PKOC', 'PONL']);
  const teacherKzd = await staff('pilot.teacher.kozhikode@medcitylms.in', 'Pilot Teacher (Kozhikode)', 'Teacher', ['PKZD']);
  await staff('pilot.admin@medcitylms.in', 'Pilot Head Office', 'Admin', ['PKOC', 'PKZD', 'PONL']);
  await db.branch.update({ where: { id: branches.get('PKOC')! }, data: { headUserId: headKochi, deputyUserId: academic } });
  await db.branch.update({ where: { id: branches.get('PKZD')! }, data: { headUserId: headKzd } });
  await db.branch.update({ where: { id: branches.get('PONL')! }, data: { headUserId: headOnline } });

  /* Programs and courses --------------------------------------------------- */
  async function program(name: string, code: string, levels: string[], skills: string[], passPercent: number | null) {
    const existing = await db.program.findFirst({ where: { organizationId: orgId, code }, select: { id: true } });
    if (existing) return existing.id;
    const row = await db.program.create({
      data: { organizationId: orgId, name, code, levels, skills, passPercent, retestRule: 'LATEST', ratingRubric: { attendance: 30, tests: 50, homework: 20, bands: [{ label: 'Needs attention', minPercent: 0 }, { label: 'On track', minPercent: 60 }, { label: 'Excellent', minPercent: 85 }] } },
    });
    return row.id;
  }
  const german = await program('German', 'PILOT-DE', ['A1', 'A2', 'B1', 'B2'], ['Listening', 'Reading', 'Writing', 'Speaking'], 60);
  const ielts = await program('IELTS', 'PILOT-IELTS', [], ['Listening', 'Reading', 'Writing', 'Speaking'], null);
  const nclex = await program('NCLEX-RN', 'PILOT-NCLEX', [], [], 65);

  async function course(slug: string, title: string, programId: string, level: string | null) {
    const product = await db.product.upsert({
      where: { organizationId_slug: { organizationId: orgId, slug } },
      create: { organizationId: orgId, type: 'COURSE', title, slug, status: 'PUBLISHED', course: { create: { organizationId: orgId, programId, level, language: 'en' } } },
      update: {},
      include: { course: true },
    });
    await db.course.update({ where: { id: product.course!.id }, data: { programId } });
    let plan = await db.pricingPlan.findFirst({ where: { productId: product.id, name: 'Pilot fees' }, select: { id: true } });
    if (!plan) plan = await db.pricingPlan.create({ data: { productId: product.id, name: 'Pilot fees', planType: 'ONE_TIME', pricePaise: 3000000, instalmentCount: 3 }, select: { id: true } });
    return { productId: product.id, courseId: product.course!.id, planId: plan.id };
  }
  const deA1 = await course('pilot-german-a1', 'German A1 (pilot)', german, 'A1');
  const deA2 = await course('pilot-german-a2', 'German A2 (pilot)', german, 'A2');
  const ie = await course('pilot-ielts', 'IELTS (pilot)', ielts, null);
  const nc = await course('pilot-nclex', 'NCLEX-RN (pilot)', nclex, null);

  /* Batches ---------------------------------------------------------------- */
  async function batch(name: string, branch: string, c: { courseId: string }, level: string | null, mode: $Enums.BatchMode, teacherId: string) {
    let row = await db.batch.findFirst({ where: { organizationId: orgId, name, deletedAt: null }, select: { id: true } });
    if (!row) row = await db.batch.create({ data: { organizationId: orgId, branchId: branches.get(branch)!, courseId: c.courseId, name, status: 'ACTIVE', level, mode, startDate: at(-30, 0) }, select: { id: true } });
    await db.batchStaff.upsert({ where: { batchId_userId_role: { batchId: row.id, userId: teacherId, role: 'PRIMARY_TUTOR' } }, create: { batchId: row.id, userId: teacherId, role: 'PRIMARY_TUTOR', startsOn: at(-30, 0) }, update: { endsOn: null } });
    return row.id;
  }
  const bKochiA1 = await batch('Pilot Kochi A1 morning', 'PKOC', deA1, 'A1', 'IN_PERSON', teacherAcross);
  const bKochiA2 = await batch('Pilot Kochi A2 evening', 'PKOC', deA2, 'A2', 'IN_PERSON', teacherAcross);
  const bKzdA1 = await batch('Pilot Kozhikode A1', 'PKZD', deA1, 'A1', 'IN_PERSON', teacherKzd);
  const bOnlineA1 = await batch('Pilot Online A1', 'PONL', deA1, 'A1', 'ONLINE', teacherAcross);
  const bOnlineIelts = await batch('Pilot Online IELTS', 'PONL', ie, null, 'ONLINE', teacherKzd);
  const bKzdNclex = await batch('Pilot Kozhikode NCLEX', 'PKZD', nc, null, 'HYBRID', teacherKzd);

  /* Learners, parents, enrolments, fees ------------------------------------ */
  interface L { key: string; name: string; parent: { name: string; phone: string } | null; batch: string; branch: string; course: { productId: string; planId: string }; paid: 0 | 1 | 2 | 3; adult?: boolean }
  const learners: L[] = [
    { key: 'anu', name: 'Anu Pilot', parent: { name: 'Meera Pilot', phone: '9000000001' }, batch: bKochiA1, branch: 'PKOC', course: deA1, paid: 1 },
    { key: 'arjun', name: 'Arjun Pilot', parent: { name: 'Meera Pilot', phone: '9000000001' }, batch: bKochiA2, branch: 'PKOC', course: deA2, paid: 2 },
    { key: 'ben', name: 'Ben Pilot', parent: { name: 'Thomas Pilot', phone: '9000000002' }, batch: bKochiA1, branch: 'PKOC', course: deA1, paid: 0 },
    { key: 'cyril', name: 'Cyril Pilot', parent: { name: 'Rosamma Pilot', phone: '9000000003' }, batch: bKochiA1, branch: 'PKOC', course: deA1, paid: 3 },
    { key: 'devi', name: 'Devi Pilot', parent: { name: 'Suresh Pilot', phone: '9000000004' }, batch: bKzdA1, branch: 'PKZD', course: deA1, paid: 1 },
    { key: 'dinesh', name: 'Dinesh Pilot', parent: { name: 'Suresh Pilot', phone: '9000000004' }, batch: bKzdNclex, branch: 'PKZD', course: nc, paid: 1 },
    { key: 'fathima', name: 'Fathima Pilot', parent: { name: 'Nazeer Pilot', phone: '9000000005' }, batch: bKzdA1, branch: 'PKZD', course: deA1, paid: 2 },
    { key: 'george', name: 'George Pilot', parent: { name: 'Annie Pilot', phone: '9000000006' }, batch: bOnlineA1, branch: 'PONL', course: deA1, paid: 1 },
    { key: 'hana', name: 'Hana Pilot', parent: { name: 'Salim Pilot', phone: '9000000007' }, batch: bOnlineA1, branch: 'PONL', course: deA1, paid: 0 },
    { key: 'irfan', name: 'Irfan Pilot', parent: { name: 'Zubaida Pilot', phone: '9000000008' }, batch: bOnlineIelts, branch: 'PONL', course: ie, paid: 1 },
    { key: 'jaya', name: 'Jaya Pilot', parent: { name: 'Ravi Pilot', phone: '9000000009' }, batch: bOnlineIelts, branch: 'PONL', course: ie, paid: 3 },
    { key: 'kiran', name: 'Kiran Pilot (adult)', parent: null, batch: bKochiA2, branch: 'PKOC', course: deA2, paid: 1, adult: true },
  ];
  const learnerIds = new Map<string, string>();
  const byBatch = new Map<string, string[]>();
  for (const [index, l] of learners.entries()) {
    const email = `pilot.${l.key}@medcitylms.in`;
    const user = await db.user.upsert({
      where: { organizationId_email: { organizationId: orgId, email } },
      create: { organizationId: orgId, email, name: l.name, kind: 'LEARNER', status: 'ACTIVE', passwordHash, emailVerifiedAt: new Date(), phone: `98000000${String(10 + index)}` },
      update: { name: l.name, kind: 'LEARNER', status: 'ACTIVE', deletedAt: null },
    });
    learnerIds.set(l.key, user.id);
    await db.learnerProfile.upsert({
      where: { userId: user.id },
      create: { userId: user.id, parentName: l.parent?.name ?? null, parentPhone: l.parent?.phone ?? null },
      update: { parentName: l.parent?.name ?? null, parentPhone: l.parent?.phone ?? null },
    });
    await db.branchMembership.upsert({ where: { userId_branchId: { userId: user.id, branchId: branches.get(l.branch)! } }, create: { userId: user.id, branchId: branches.get(l.branch)!, isPrimary: true }, update: {} });
    if (l.parent) {
      await db.parentLink.upsert({
        where: { learnerId_contact: { learnerId: user.id, contact: l.parent.phone } },
        create: { organizationId: orgId, learnerId: user.id, contact: l.parent.phone, name: l.parent.name, relationship: 'parent', status: 'ACTIVE', verifiedHow: 'record', verifiedAt: new Date() },
        update: { status: 'ACTIVE', revokedAt: null, revokedById: null, revokedReason: null },
      });
    }
    let enrolment = await db.enrollment.findFirst({ where: { organizationId: orgId, userId: user.id, productId: l.course.productId }, select: { id: true } });
    if (!enrolment) {
      enrolment = await db.enrollment.create({
        data: { organizationId: orgId, branchId: branches.get(l.branch)!, userId: user.id, productId: l.course.productId, batchId: l.batch, status: 'ENROLLED', source: 'ADMIN_SINGLE', pricingPlanId: l.course.planId, startsAt: at(-30, 0) },
        select: { id: true },
      });
      // Three instalments: one already due last month, one due in ten days, one in forty.
      const dues = [at(-25, 0), at(10, 0), at(40, 0)];
      for (let i = 0; i < 3; i += 1) {
        await db.instalment.create({ data: { enrollmentId: enrolment.id, sequence: i + 1, amountPaise: 1000000, dueDate: dues[i], paidPaise: i < l.paid ? 1000000 : 0, paidAt: i < l.paid ? at(-26 + i, 11) : null } });
      }
    } else {
      await db.enrollment.update({ where: { id: enrolment.id }, data: { batchId: l.batch, status: 'ENROLLED' } });
    }
    byBatch.set(l.batch, [...(byBatch.get(l.batch) ?? []), user.id]);
  }

  /* Classes and attendance, the last two weeks and today ------------------- */
  const pattern: $Enums.AttendanceStatus[] = ['PRESENT', 'PRESENT', 'LATE', 'PRESENT', 'ABSENT', 'PRESENT', 'PRESENT', 'EXCUSED', 'PRESENT', 'PRESENT'];
  const batchHours: [string, number, boolean][] = [[bKochiA1, 10, false], [bKochiA2, 17, false], [bKzdA1, 10, false], [bOnlineA1, 19, true], [bOnlineIelts, 20, true], [bKzdNclex, 15, false]];
  for (const [batchId, hour, online] of batchHours) {
    const roll = byBatch.get(batchId) ?? [];
    for (let d = -14; d <= 0; d += 1) {
      const dow = new Date(at(d, 12)).getUTCDay();
      if (dow === 0) continue; // no Sunday class
      const startsAt = at(d, hour);
      const title = `Class ${15 + d}`;
      let session = await db.liveSession.findFirst({ where: { organizationId: orgId, batchId, startsAt }, select: { id: true } });
      const past = d < 0;
      if (!session) {
        session = await db.liveSession.create({
          data: { organizationId: orgId, batchId, title, startsAt, endsAt: new Date(startsAt.getTime() + 60 * 60_000), status: past ? 'COMPLETED' : 'SCHEDULED', provider: online ? 'zoom' : 'offline', registerSubmittedAt: past && d !== -1 ? new Date(startsAt.getTime() + 90 * 60_000) : null },
          select: { id: true },
        });
      }
      if (!past) continue;
      for (const [i, userId] of roll.entries()) {
        const status = pattern[(i + d + 20) % pattern.length];
        const existing = await db.attendance.findFirst({ where: { sessionId: session.id, userId }, select: { id: true } });
        if (existing) continue;
        await db.attendance.create({ data: { sessionId: session.id, userId, status, minutesPresent: status === 'ABSENT' ? 0 : status === 'LATE' ? 45 : 60, wasInTime: status === 'PRESENT', source: online ? 'PROVIDER' : 'REGISTER', recordedAt: new Date(startsAt.getTime() + 5 * 60_000) } });
      }
    }
  }

  /* Mark sheets: one published, one waiting, one draft --------------------- */
  async function sheet(batchId: string, title: string, category: string, skill: string | null, status: $Enums.MarkSheetStatus, testDay: number, createdById: string, decidedById: string | null) {
    const existing = await db.markSheet.findFirst({ where: { organizationId: orgId, batchId, title }, select: { id: true } });
    if (existing) return;
    const roll = byBatch.get(batchId) ?? [];
    const testDate = at(testDay, 10);
    await db.markSheet.create({
      data: {
        organizationId: orgId,
        batchId,
        title,
        category,
        skill,
        testDate,
        maxMarks: 50,
        passPercent: 60,
        status,
        createdById,
        submittedAt: status === 'DRAFT' ? null : new Date(testDate.getTime() + DAY),
        submittedById: status === 'DRAFT' ? null : createdById,
        decidedAt: status === 'PUBLISHED' ? new Date(testDate.getTime() + 2 * DAY) : null,
        decidedById: status === 'PUBLISHED' ? decidedById : null,
        publishedAt: status === 'PUBLISHED' ? new Date(testDate.getTime() + 2 * DAY) : null,
        entries: {
          create: roll.map((userId, i) => {
            const marks = [42, 28, 35, 47, 31, 39][i % 6];
            const absent = i % 5 === 4;
            return { userId, outcome: absent ? 'ABSENT' : 'SCORED', marks: absent ? null : marks, grade: absent ? null : marks >= 45 ? 'A' : marks >= 35 ? 'B' : marks >= 30 ? 'C' : 'D', passed: absent ? null : marks / 50 >= 0.6, remark: absent ? null : marks >= 40 ? 'Steady work.' : 'Needs more practice with the workbook.' };
          }),
        },
      },
    });
  }
  await sheet(bKochiA1, 'Pilot unit 1 test', 'Class Test', 'Reading', 'PUBLISHED', -9, teacherAcross, headKochi);
  await sheet(bKochiA1, 'Pilot unit 2 test', 'Class Test', 'Writing', 'SUBMITTED', -2, teacherAcross, null);
  await sheet(bKochiA2, 'Pilot mock A2', 'Mock Test', null, 'DRAFT', -1, teacherAcross, null);
  await sheet(bKzdA1, 'Pilot unit 1 test', 'Class Test', 'Listening', 'PUBLISHED', -8, teacherKzd, headKzd);
  await sheet(bOnlineA1, 'Pilot unit 1 test', 'Class Test', 'Speaking', 'PUBLISHED', -7, teacherAcross, headOnline);
  await sheet(bOnlineIelts, 'Pilot IELTS mock 1', 'Mock Test', null, 'SUBMITTED', -3, teacherKzd, null);

  /* A draft notice for the office to publish during the pilot -------------- */
  const noticeTitle = 'Pilot: parent-teacher meeting';
  const notice = await db.notice.findFirst({ where: { organizationId: orgId, title: noticeTitle }, select: { id: true } });
  if (!notice) {
    await db.notice.create({
      data: {
        organizationId: orgId,
        kind: 'MEETING',
        title: noticeTitle,
        body: 'Parents of the Kochi A1 batch are invited to meet the teacher and the Branch Head. Bring the fee receipt if you paid at the counter.',
        branchIds: [],
        batchIds: [bKochiA1],
        toParents: true,
        toLearners: false,
        meetingAt: at(7, 10),
        meetingEndsAt: at(7, 11),
        venue: 'Pilot Kochi, room 2',
        instructions: 'Ask for the Branch Head at the desk.',
        status: 'DRAFT',
        createdById: headKochi,
      },
    });
  }

  console.log('');
  console.log('Pilot accounts (password from PILOT_PASSWORD, default Pilot#2026):');
  console.log('  Head Office        pilot.admin@medcitylms.in');
  console.log('  Branch Heads       pilot.head.kochi@ / pilot.head.kozhikode@ / pilot.head.online@medcitylms.in');
  console.log('  Academic Manager   pilot.academic@medcitylms.in (Kochi and Kozhikode)');
  console.log('  Teacher, 2 branches pilot.teacher.across@medcitylms.in (Kochi A1, Kochi A2, Online A1)');
  console.log('  Teacher, Kozhikode pilot.teacher.kozhikode@medcitylms.in');
  console.log('  Parents sign in at /parent with a code sent to: 9000000001 (two children: Anu, Arjun), 9000000002 to 9000000009');
  console.log('  Learners: pilot.<name>@medcitylms.in, same password. Kiran is the adult learner with no parent.');
  console.log('Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
