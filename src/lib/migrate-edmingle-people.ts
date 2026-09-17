import { db } from '@/lib/db';
import { batches, batchStudentsPage, edmingleFor, packages, studentsPage } from '@/lib/edmingle';
import { batchState, epochDate, learnerRow, packagePaise } from '@/lib/edmingle-records';
import { migrated, mark, problem, report, sample, type EdmingleReport } from '@/lib/migrate-edmingle';

/**
 * The people side of leaving Edmingle: learners, batches, who sits in
 * which batch, and what the courses sold for.
 *
 * Learners are matched on Edmingle's id first and email second, so a
 * learner who already signed up here is linked rather than doubled, and
 * the record here keeps its name and number. Nobody gets a password: they
 * sign in with a code, or set one through the forgotten-password flow.
 * Enrolments come from the batch rolls, because that is where Edmingle
 * keeps the fact of who is in a class, and each is written once against
 * the batch and learner it joins.
 */

const BUDGET_MS = 45_000;

async function defaultBranch(organizationId: string): Promise<string | null> {
  const b = await db.branch.findFirst({ where: { organizationId, isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true } });
  return b?.id ?? null;
}

/* Learners ------------------------------------------------------------------- */

export async function importLearners(organizationId: string, options: { dryRun: boolean; budgetMs?: number }): Promise<EdmingleReport> {
  const r = report('learners');
  const client = await edmingleFor(organizationId);
  if (!client) {
    problem(r, 'Edmingle is not connected.');
    return r;
  }
  const branchId = await defaultBranch(organizationId);
  if (!branchId) {
    problem(r, 'This academy has no active branch to put learners in.');
    return r;
  }
  const started = Date.now();
  const budget = options.budgetMs ?? BUDGET_MS;
  const done = await migrated('learner');
  // Pages already walked to the end are remembered, so a re-run starts where it stopped.
  const pagesDone = await migrated('learner-page');
  let page = 1;
  while (pagesDone.has(String(page))) page += 1;

  for (; page <= 200; page += 1) {
    if (Date.now() - started > budget) {
      r.remaining += 1;
      break;
    }
    let batch;
    try {
      batch = await studentsPage(client, page);
    } catch (err) {
      problem(r, `Learners page ${page}: ${err instanceof Error ? err.message : String(err)}`);
      break;
    }
    if (page === 1) sample(r, `${batch.total} learners in Edmingle.`);
    let pageComplete = true;
    for (const s of batch.students) {
      r.looked += 1;
      const key = String(s.user_id);
      if (done.has(key)) {
        r.alreadyDone += 1;
        continue;
      }
      const row = learnerRow(s);
      if (!row.email && !row.phone) {
        problem(r, `${row.name} (${key}) has neither an email nor a usable phone, so there is no way to sign them in; skipped.`);
        continue;
      }
      const existing = row.email ? await db.user.findFirst({ where: { organizationId, email: row.email, deletedAt: null }, select: { id: true } }) : null;
      if (existing) {
        r.wouldUpdate += 1;
        if (!options.dryRun) {
          await db.user.update({ where: { id: existing.id }, data: { legacyEdmingleId: key } });
          await mark('learner', key, existing.id, { linked: true });
          done.set(key, existing.id);
        } else sample(r, `link: ${row.name} (already has an account here)`);
        continue;
      }
      r.wouldCreate += 1;
      if (options.dryRun) {
        sample(r, `new: ${row.name}${row.registrationNo ? ` #${row.registrationNo}` : ''}${row.archived ? ' (archived)' : ''}`);
        continue;
      }
      try {
        const phoneTaken = row.phone ? await db.user.findFirst({ where: { organizationId, phone: row.phone }, select: { id: true } }) : null;
        const regTaken = row.registrationNo ? await db.user.findFirst({ where: { organizationId, registrationNo: row.registrationNo }, select: { id: true } }) : null;
        const created = await db.user.create({
          data: {
            organizationId,
            name: row.name,
            email: row.email,
            phone: phoneTaken ? null : row.phone,
            kind: 'LEARNER',
            status: row.archived ? 'ARCHIVED' : 'ACTIVE',
            registrationNo: regTaken ? null : row.registrationNo,
            legacyEdmingleId: key,
            createdAt: row.addedOn ?? undefined,
            branchMemberships: { create: { branchId, isPrimary: true } },
            learnerProfile: { create: row.profile },
          },
          select: { id: true },
        });
        if (phoneTaken) problem(r, `${row.name}: phone already belongs to another account here, left blank.`);
        await mark('learner', key, created.id, { name: row.name });
        done.set(key, created.id);
      } catch (err) {
        pageComplete = false;
        problem(r, `${row.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (!options.dryRun && pageComplete) await mark('learner-page', String(page), null);
    if (!batch.more) break;
  }
  if (r.remaining) sample(r, 'More learners to read: press again.');
  return r;
}

/* Batches -------------------------------------------------------------------- */

export async function importBatches(organizationId: string, options: { dryRun: boolean }): Promise<EdmingleReport> {
  const r = report('batches');
  const client = await edmingleFor(organizationId);
  if (!client) {
    problem(r, 'Edmingle is not connected.');
    return r;
  }
  const branchId = await defaultBranch(organizationId);
  if (!branchId) {
    problem(r, 'This academy has no active branch to put batches in.');
    return r;
  }
  let all;
  try {
    all = await batches(client);
  } catch (err) {
    problem(r, err instanceof Error ? err.message : String(err));
    return r;
  }
  const [done, courses] = await Promise.all([migrated('batch'), migrated('course')]);
  const now = new Date();
  r.looked = all.length;
  sample(r, `${all.length} batches in Edmingle.`);
  for (const { bundleId, bundleName, batch } of all) {
    const key = String(batch.class_id);
    if (done.has(key)) {
      r.alreadyDone += 1;
      continue;
    }
    const productId = courses.get(String(bundleId));
    if (!productId) {
      problem(r, `${batch.class_name}: its course (${bundleName}) has not come across yet, so the batch waits.`);
      continue;
    }
    r.wouldCreate += 1;
    if (options.dryRun) {
      sample(r, `${batch.class_name} [${batchState(batch, now)}] in ${bundleName}`);
      continue;
    }
    try {
      const course = await db.course.findFirst({ where: { productId, organizationId }, select: { id: true } });
      if (!course) throw new Error('course row missing');
      const created = await db.batch.create({
        data: {
          organizationId,
          branchId,
          courseId: course.id,
          name: batch.class_name.trim().slice(0, 200) || `Batch ${key}`,
          status: batchState(batch, now),
          startDate: epochDate(batch.start_date),
          endDate: epochDate(batch.end_date),
          legacyEdmingleId: key,
        },
        select: { id: true },
      });
      await mark('batch', key, created.id, { name: batch.class_name, bundleId, productId, tutor: batch.tutor_name ?? null });
    } catch (err) {
      problem(r, `${batch.class_name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return r;
}

/* Enrolments ------------------------------------------------------------------- */

export async function importEnrollments(organizationId: string, options: { dryRun: boolean; budgetMs?: number }): Promise<EdmingleReport> {
  const r = report('enrolments');
  const client = await edmingleFor(organizationId);
  if (!client) {
    problem(r, 'Edmingle is not connected.');
    return r;
  }
  const branchId = await defaultBranch(organizationId);
  if (!branchId) {
    problem(r, 'This academy has no active branch.');
    return r;
  }
  const started = Date.now();
  const budget = options.budgetMs ?? BUDGET_MS;
  const [batchRows, learners, rollsDone, done] = await Promise.all([
    db.migrationRecord.findMany({ where: { sourceSystem: 'EDMINGLE', entity: 'batch', status: 'MIGRATED' }, select: { sourceId: true, targetId: true, payload: true } }),
    migrated('learner'),
    migrated('batch-roll'),
    migrated('enrolment'),
  ]);
  const pending = batchRows.filter((b) => b.targetId && !rollsDone.has(b.sourceId));
  r.looked = pending.length;
  if (pending.length === 0) {
    sample(r, 'Every batch roll has been read.');
    return r;
  }
  let processed = 0;
  let missingLearners = 0;
  for (const b of pending) {
    if (Date.now() - started > budget) break;
    const payload = (b.payload ?? {}) as { productId?: string; name?: string };
    const batch = await db.batch.findFirst({ where: { id: b.targetId!, organizationId }, select: { id: true, status: true, startDate: true } });
    if (!batch || !payload.productId) {
      problem(r, `${payload.name ?? b.sourceId}: batch row missing here.`);
      continue;
    }
    let complete = true;
    for (let page = 1; page <= 100; page += 1) {
      let roll;
      try {
        roll = await batchStudentsPage(client, Number(b.sourceId), page);
      } catch (err) {
        problem(r, `${payload.name ?? b.sourceId} page ${page}: ${err instanceof Error ? err.message : String(err)}`);
        complete = false;
        break;
      }
      for (const s of roll.students) {
        const key = `${b.sourceId}:${s.user_id}`;
        if (done.has(key)) {
          r.alreadyDone += 1;
          continue;
        }
        const userId = learners.get(String(s.user_id));
        if (!userId) {
          missingLearners += 1;
          complete = false;
          continue;
        }
        r.wouldCreate += 1;
        if (options.dryRun) {
          if (r.samples.length < 8) sample(r, `${s.name ?? s.user_id} -> ${payload.name ?? b.sourceId}`);
          continue;
        }
        try {
          const already = await db.enrollment.findFirst({ where: { organizationId, userId, productId: payload.productId, batchId: batch.id }, select: { id: true } });
          const id =
            already?.id ??
            (
              await db.enrollment.create({
                data: {
                  organizationId,
                  branchId,
                  userId,
                  productId: payload.productId,
                  batchId: batch.id,
                  status: batch.status === 'COMPLETED' || batch.status === 'ARCHIVED' ? 'COMPLETED' : 'ENROLLED',
                  source: 'IMPORT',
                  startsAt: epochDate(s.classusers_start_date) ?? batch.startDate ?? new Date(),
                  completedAt: batch.status === 'COMPLETED' ? new Date() : null,
                  progressPercent: Math.max(0, Math.min(100, Number(s.progress) || 0)),
                  legacyEdmingleId: key,
                },
                select: { id: true },
              })
            ).id;
          await mark('enrolment', key, id);
          done.set(key, id);
        } catch (err) {
          complete = false;
          problem(r, `${s.name ?? s.user_id} in ${payload.name ?? b.sourceId}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (!roll.more) break;
    }
    processed += 1;
    if (!options.dryRun && complete) await mark('batch-roll', b.sourceId, b.targetId);
  }
  if (missingLearners) problem(r, `${missingLearners} learners on the rolls are not here yet: run the learners step to the end, then press this again.`);
  r.remaining = Math.max(0, pending.length - processed);
  if (r.remaining) sample(r, `${r.remaining} batch rolls still to read: press again.`);
  return r;
}

/* Prices --------------------------------------------------------------------- */

export async function importPrices(organizationId: string, options: { dryRun: boolean }): Promise<EdmingleReport> {
  const r = report('prices');
  const client = await edmingleFor(organizationId);
  if (!client) {
    problem(r, 'Edmingle is not connected.');
    return r;
  }
  let all;
  try {
    all = await packages(client);
  } catch (err) {
    problem(r, err instanceof Error ? err.message : String(err));
    return r;
  }
  const [done, courses] = await Promise.all([migrated('price'), migrated('course')]);
  r.looked = all.length;
  for (const p of all) {
    const key = String(p.package_id);
    if (done.has(key)) {
      r.alreadyDone += 1;
      continue;
    }
    const paise = packagePaise(p);
    if (paise === null) continue;
    const productId = courses.get(String(p.bundle_id));
    if (!productId) {
      problem(r, `${p.package_name ?? key}: its course has not come across yet.`);
      continue;
    }
    const has = await db.pricingPlan.findFirst({ where: { productId, isActive: true }, select: { id: true } });
    if (has) {
      r.alreadyDone += 1;
      if (!options.dryRun) await mark('price', key, has.id, { skipped: 'course already priced here' });
      continue;
    }
    r.wouldCreate += 1;
    if (options.dryRun) {
      sample(r, `${p.package_name ?? key}: Rs ${(paise / 100).toLocaleString('en-IN')}`);
      continue;
    }
    try {
      const plan = await db.pricingPlan.create({ data: { productId, name: (p.package_name ?? 'Standard').trim().slice(0, 100) || 'Standard', planType: 'ONE_TIME', currency: 'INR', pricePaise: paise, isActive: true }, select: { id: true } });
      await mark('price', key, plan.id, { paise });
    } catch (err) {
      problem(r, `${p.package_name ?? key}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return r;
}
