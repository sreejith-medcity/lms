/**
 * Copy every locally stored file into the configured bucket.
 *
 *   npm run storage:migrate -- --dry-run
 *   npm run storage:migrate
 *
 * Run it on the machine holding the files, which is the server, not a laptop.
 * Nothing is deleted and no database row changes: the keys are the same on
 * both sides, so the switch back is putting the environment variables back.
 */

import { migrateLocalAssetsToBucket, formatMigration } from '../src/lib/storage-migrate';

const dryRun = process.argv.includes('--dry-run');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : undefined;

console.log(dryRun ? 'Dry run. Nothing will be written.' : 'Copying files into the bucket.');

const report = await migrateLocalAssetsToBucket({
  dryRun,
  limit: Number.isFinite(limit) ? limit : undefined,
});

console.log(formatMigration(report));
process.exitCode = report.failed > 0 ? 1 : 0;
