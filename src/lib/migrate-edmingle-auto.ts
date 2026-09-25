import { db } from '@/lib/db';
import { recentIntegrationEvents, recordIntegrationEvent } from '@/lib/integration-events';
import { attachVideos, importCatalogue, importFiles, type EdmingleReport } from '@/lib/migrate-edmingle';
import { importBatches, importEnrollments, importLearners, importPrices } from '@/lib/migrate-edmingle-people';
import { importQuestions } from '@/lib/migrate-edmingle-questions';
import { importAttendance, importCertificates, importProgress, importSessions, importStaff } from '@/lib/migrate-edmingle-archive';

/**
 * The import running by itself.
 *
 * Edmingle allows only a handful of calls a minute, so a library of this
 * size cannot be pulled across in an afternoon of button presses. With the
 * switch on, every run of the cron (the five-minute messaging job, or the
 * one-minute Edmingle job at /api/cron/edmingle) does a little of the next
 * step that has work, in the order the steps depend on each other, and
 * writes a line to the Edmingle card's history saying what it did. The
 * documents go last on purpose: six thousand PDFs take hours even a minute
 * at a time, and the archive (who taught what, who attended, who passed)
 * should not wait behind them. The
 * switch is a row in the migration records rather than a setting, because
 * it belongs to the migration and dies with it.
 */

const SOURCE = 'EDMINGLE';
/** One switch per academy; the row written before ff2369c had no academy on it and still counts, so a run in progress is not switched off by a deploy. */
const flag = (organizationId: string) => ({ sourceSystem: SOURCE, entity: 'auto', sourceId: organizationId });
const LEGACY_FLAG = { sourceSystem: SOURCE, entity: 'auto', sourceId: 'edmingle' };

export async function edmingleAutoOn(organizationId: string): Promise<boolean> {
  const rows = await db.migrationRecord.findMany({ where: { sourceSystem: SOURCE, entity: 'auto', sourceId: { in: [organizationId, LEGACY_FLAG.sourceId] } }, select: { sourceId: true, status: true } });
  const own = rows.find((r) => r.sourceId === organizationId);
  if (own) return own.status === 'MIGRATED';
  return rows.some((r) => r.status === 'MIGRATED');
}

export async function setEdmingleAuto(organizationId: string, on: boolean): Promise<void> {
  const where = flag(organizationId);
  await db.migrationRecord.upsert({
    where: { sourceSystem_entity_sourceId: where },
    create: { ...where, status: on ? 'MIGRATED' : 'SKIPPED', migratedAt: on ? new Date() : null },
    update: { status: on ? 'MIGRATED' : 'SKIPPED', migratedAt: on ? new Date() : null },
  });
  await db.migrationRecord.deleteMany({ where: LEGACY_FLAG });
  // Flipping the switch forgets which steps were finished, so a fresh
  // switch-on looks at every step once more (Edmingle may have moved on).
  await db.migrationRecord.deleteMany({ where: { ...DONE, sourceId: { startsWith: `${organizationId}:` } } });
}

/**
 * A step that reported nothing to do is remembered as finished and skipped
 * on later ticks. Without this every tick walked all thirteen steps, and
 * the finished ones still called Edmingle to re-read their listings (the
 * sessions step alone reads 3,700 rows) before the documents step got its
 * turn, by which point the minute's allowance of calls was spent and the
 * documents were told "later" on every tick, for ever. Pressing a step by
 * hand on the Migration page still runs it whatever this says.
 */
const DONE = { sourceSystem: SOURCE, entity: 'auto-done' };

async function finishedSteps(organizationId: string): Promise<Set<string>> {
  const rows = await db.migrationRecord.findMany({
    where: { ...DONE, sourceId: { startsWith: `${organizationId}:` }, status: 'MIGRATED' },
    select: { sourceId: true },
  });
  return new Set(rows.map((r) => r.sourceId.slice(organizationId.length + 1)));
}

async function markFinished(organizationId: string, key: string): Promise<void> {
  const where = { ...DONE, sourceId: `${organizationId}:${key}` };
  await db.migrationRecord.upsert({
    where: { sourceSystem_entity_sourceId: where },
    create: { ...where, status: 'MIGRATED', migratedAt: new Date() },
    update: { status: 'MIGRATED', migratedAt: new Date() },
  });
}

const ORDER: { key: string; run: (organizationId: string, budgetMs: number) => Promise<EdmingleReport> }[] = [
  { key: 'catalogue', run: (o, b) => importCatalogue(o, { dryRun: false, budgetMs: b }) },
  { key: 'prices', run: (o) => importPrices(o, { dryRun: false }) },
  { key: 'learners', run: (o, b) => importLearners(o, { dryRun: false, budgetMs: b }) },
  { key: 'batches', run: (o) => importBatches(o, { dryRun: false }) },
  { key: 'enrolments', run: (o, b) => importEnrollments(o, { dryRun: false, budgetMs: b }) },
  { key: 'questions', run: (o, b) => importQuestions(o, { dryRun: false, budgetMs: b }) },
  { key: 'staff', run: (o) => importStaff(o, { dryRun: false }) },
  { key: 'sessions', run: (o, b) => importSessions(o, { dryRun: false, budgetMs: b }) },
  { key: 'attendance', run: (o, b) => importAttendance(o, { dryRun: false, budgetMs: b }) },
  { key: 'progress', run: (o, b) => importProgress(o, { dryRun: false, budgetMs: b }) },
  { key: 'certificates', run: (o, b) => importCertificates(o, { dryRun: false, budgetMs: b }) },
  { key: 'files', run: (o, b) => importFiles(o, { dryRun: false, budgetMs: b, max: 60 }) },
  { key: 'videos', run: (o) => attachVideos(o, { dryRun: false }) },
];

/**
 * One tick: the first step in order that still has something to do gets
 * the budget; the rest wait for the next tick. Returns a short line for
 * the cron's own log, or null when the switch is off.
 */
export async function runEdmingleAuto(organizationId: string, budgetMs = 25_000): Promise<string | null> {
  if (!(await edmingleAutoOn(organizationId))) return null;
  if (!(await takeLease(organizationId, budgetMs + 20_000))) return 'another run is still going';
  try {
    return await tick(organizationId, budgetMs);
  } finally {
    await releaseLease(organizationId);
  }
}

/**
 * Two schedules call this (the five-minute messaging job, and the
 * one-minute Edmingle job when the host has it), so a run takes a lease
 * first: a row whose time is when the lease ends. Claiming it is one
 * update that only succeeds while the old lease has run out, so two ticks
 * landing together cannot both pull the same documents into the bucket.
 */
const LEASE = { sourceSystem: SOURCE, entity: 'auto-lease' };

async function takeLease(organizationId: string, forMs: number): Promise<boolean> {
  const now = new Date();
  const until = new Date(now.getTime() + forMs);
  await db.migrationRecord.upsert({
    where: { sourceSystem_entity_sourceId: { ...LEASE, sourceId: organizationId } },
    create: { ...LEASE, sourceId: organizationId, status: 'SKIPPED', migratedAt: new Date(0) },
    update: {},
  });
  const claimed = await db.migrationRecord.updateMany({
    where: { ...LEASE, sourceId: organizationId, migratedAt: { lt: now } },
    data: { migratedAt: until },
  });
  return claimed.count === 1;
}

async function releaseLease(organizationId: string): Promise<void> {
  await db.migrationRecord.updateMany({ where: { ...LEASE, sourceId: organizationId }, data: { migratedAt: new Date(0) } });
}

async function tick(organizationId: string, budgetMs: number): Promise<string> {
  const started = Date.now();
  const lines: string[] = [];
  const done = await finishedSteps(organizationId);
  for (const step of ORDER) {
    /* A documents mark left by an earlier build is ignored for the same reason (below). */
    if (done.has(step.key) && step.key !== 'files') continue;
    const left = budgetMs - (Date.now() - started);
    if (left < 5_000) break;
    let report: EdmingleReport;
    try {
      report = await step.run(organizationId, left);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await recordIntegrationEvent({ organizationId, provider: 'edmingle', direction: 'IN', action: `auto ${step.key}`, ok: false, detail: message.slice(0, 400) });
      return `${step.key}: ${message}`;
    }
    const moved = report.wouldCreate + report.wouldUpdate;
    const limited = report.problems.some((p) => /rate-limiting/.test(p));
    // Being rate-limited is a wait, not a failure: Edmingle said "later"
    // and the next tick tries again. Only a real problem marks the row red.
    const realProblems = report.problems.filter((p) => !/rate-limiting/.test(p));
    // A step with nothing moved and nothing left is finished, standing
    // notes or not (a module Edmingle lists but does not have; one session
    // whose batch never came across): those were reported when the step did
    // its work, and a row every minute would only bury the steps still
    // moving. It is remembered so the next tick does not read it again.
    //
    // Except the documents: a lesson whose file failed (an hour) or was not
    // in the library (a day) comes due again later, and a step marked
    // finished would never look at it. With nothing due it returns before
    // calling Edmingle, so looking every tick costs nothing.
    const finished = step.key !== 'files' && moved === 0 && report.remaining === 0 && !limited && !report.setAside;
    if (finished) await markFinished(organizationId, step.key);
    if (!finished && (moved > 0 || limited || report.remaining > 0 || report.problems.length > 0 || report.setAside)) {
      const detail = `${limited ? "waiting on Edmingle's rate limit; " : ''}${moved} across, ${report.alreadyDone} already, ${report.remaining} left${report.setAside ? `; ${report.setAside} set aside (no such file in Edmingle)` : ''}${realProblems.length ? `; ${realProblems.length} notes: ${realProblems[0].slice(0, 160)}` : ''}${moved === 0 && !realProblems.length && report.samples[0] ? `; ${report.samples[0].slice(0, 200)}` : ''}`;
      // A tick that moved nothing and says exactly what the last one said
      // (a wait on the asset library, a minute later) adds nothing: one row
      // per state, not one per minute.
      const quiet = moved === 0 && !limited;
      const last = quiet ? (await recentIntegrationEvents(organizationId, 'edmingle', 1))[0] : undefined;
      if (quiet && last && last.action === `auto ${step.key}` && last.detail === detail) {
        lines.push(`${step.key} unchanged`);
        break;
      }
      await recordIntegrationEvent({
        organizationId,
        provider: 'edmingle',
        direction: 'IN',
        action: `auto ${step.key}`,
        ok: realProblems.length === 0,
        records: moved,
        // A tick that moved nothing but has something to say (a wait on the
        // asset library, a listing carrying on) says it, so the history reads.
        detail,
      });
      lines.push(`${step.key} ${moved} across, ${report.remaining} left${limited ? ', waiting' : ''}`);
    }
    // Rate-limited: give Edmingle the rest of the window.
    if (limited) break;
    // This step did work or still has work: leave the later steps for the next tick.
    if (moved > 0 || report.remaining > 0) break;
  }
  return lines.length ? lines.join('; ') : 'nothing to do';
}
