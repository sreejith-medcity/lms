import { db } from '@/lib/db';
import { recordIntegrationEvent } from '@/lib/integration-events';
import { attachVideos, importCatalogue, importFiles, type EdmingleReport } from '@/lib/migrate-edmingle';
import { importBatches, importEnrollments, importLearners, importPrices } from '@/lib/migrate-edmingle-people';
import { importQuestions } from '@/lib/migrate-edmingle-questions';

/**
 * The import running by itself.
 *
 * Edmingle allows only a handful of calls a minute, so a library of this
 * size cannot be pulled across in an afternoon of button presses. With the
 * switch on, every run of the five-minute cron does a little of the next
 * step that has work, in the order the steps depend on each other, and
 * writes a line to the Edmingle card's history saying what it did. The
 * switch is a row in the migration records rather than a setting, because
 * it belongs to the migration and dies with it.
 */

const SOURCE = 'EDMINGLE';
const FLAG = { sourceSystem: SOURCE, entity: 'auto', sourceId: 'edmingle' };

export async function edmingleAutoOn(): Promise<boolean> {
  const row = await db.migrationRecord.findUnique({ where: { sourceSystem_entity_sourceId: FLAG }, select: { status: true } });
  return row?.status === 'MIGRATED';
}

export async function setEdmingleAuto(on: boolean): Promise<void> {
  await db.migrationRecord.upsert({
    where: { sourceSystem_entity_sourceId: FLAG },
    create: { ...FLAG, status: on ? 'MIGRATED' : 'SKIPPED', migratedAt: on ? new Date() : null },
    update: { status: on ? 'MIGRATED' : 'SKIPPED', migratedAt: on ? new Date() : null },
  });
}

const ORDER: { key: string; run: (organizationId: string, budgetMs: number) => Promise<EdmingleReport> }[] = [
  { key: 'catalogue', run: (o, b) => importCatalogue(o, { dryRun: false, budgetMs: b }) },
  { key: 'prices', run: (o) => importPrices(o, { dryRun: false }) },
  { key: 'learners', run: (o, b) => importLearners(o, { dryRun: false, budgetMs: b }) },
  { key: 'batches', run: (o) => importBatches(o, { dryRun: false }) },
  { key: 'enrolments', run: (o, b) => importEnrollments(o, { dryRun: false, budgetMs: b }) },
  { key: 'questions', run: (o, b) => importQuestions(o, { dryRun: false, budgetMs: b }) },
  { key: 'files', run: (o, b) => importFiles(o, { dryRun: false, budgetMs: b, max: 15 }) },
  { key: 'videos', run: (o) => attachVideos(o, { dryRun: false }) },
];

/**
 * One tick: the first step in order that still has something to do gets
 * the budget; the rest wait for the next tick. Returns a short line for
 * the cron's own log, or null when the switch is off.
 */
export async function runEdmingleAuto(organizationId: string, budgetMs = 25_000): Promise<string | null> {
  if (!(await edmingleAutoOn())) return null;
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
    if (moved > 0 || limited || report.problems.length > 0) {
      await recordIntegrationEvent({
        organizationId,
        provider: 'edmingle',
        direction: 'IN',
        action: `auto ${step.key}`,
        ok: !limited,
        records: moved,
        detail: `${moved} across, ${report.alreadyDone} already, ${report.remaining} left${report.problems.length ? `; ${report.problems.length} notes: ${report.problems[0].slice(0, 160)}` : ''}`,
      });
      lines.push(`${step.key} ${moved} across, ${report.remaining} left`);
    }
    // Rate-limited: give Edmingle the rest of the window.
    if (limited) break;
    // This step did work or still has work: leave the later steps for the next tick.
    if (moved > 0 || report.remaining > 0) break;
  }
  return lines.length ? lines.join('; ') : 'nothing to do';
}
