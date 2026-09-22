import { db } from '@/lib/db';
import { recordIntegrationEvent } from '@/lib/integration-events';
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
  for (const step of ORDER) {
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
    // A finished step repeats its standing notes on every tick (a module
    // Edmingle lists but does not have, say); those were reported when the
    // step did its work, and a row every five minutes would only bury the
    // steps still moving. A note on something not yet across still shows.
    const finished = moved === 0 && report.remaining === 0 && !limited && report.alreadyDone >= report.looked;
    if (!finished && (moved > 0 || limited || report.remaining > 0 || report.problems.length > 0)) {
      await recordIntegrationEvent({
        organizationId,
        provider: 'edmingle',
        direction: 'IN',
        action: `auto ${step.key}`,
        ok: realProblems.length === 0,
        records: moved,
        detail: `${limited ? "waiting on Edmingle's rate limit; " : ''}${moved} across, ${report.alreadyDone} already, ${report.remaining} left${realProblems.length ? `; ${realProblems.length} notes: ${realProblems[0].slice(0, 160)}` : ''}`,
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
