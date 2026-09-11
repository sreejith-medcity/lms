import { readFile, stat } from 'node:fs/promises';
import { db } from '@/lib/db';
import { localPathFor, presign, s3Config, statObject } from '@/lib/storage';

/**
 * Moving what is already uploaded into the bucket.
 *
 * Switching the storage driver is five environment variables, and on its own
 * it breaks every file uploaded before the switch: the rows still point at
 * keys, but the keys now resolve to a bucket that has never heard of them, so
 * the hero image, the course thumbnails and every recording become holes.
 *
 * This copies them across. It is safe to run twice, because a key already in
 * the bucket is skipped rather than re-uploaded, and it is safe to run while
 * the site is up, because nothing is deleted from the disk and nothing in the
 * database changes: the keys are identical on both sides. That is what makes
 * the switch reversible. Delete the local copies weeks later, once the bucket
 * has plainly been serving them.
 */

export interface MigrationReport {
  looked: number;
  copied: number;
  skipped: number;
  missing: number;
  failed: number;
  bytes: number;
  problems: string[];
  lines: string[];
}

/** Big files go up in one PUT, so this is the ceiling a single request can take. */
const MAX_SINGLE_PUT = 200 * 1024 * 1024;

async function uploadOne(key: string, body: Buffer, mimeType: string): Promise<void> {
  const url = presign('PUT', key, 900);
  const response = await fetch(url, {
    method: 'PUT',
    body: new Uint8Array(body),
    headers: { 'content-type': mimeType || 'application/octet-stream' },
  });
  if (!response.ok) {
    throw new Error(`bucket answered ${response.status} ${await response.text().catch(() => '')}`.trim());
  }
}

export async function migrateLocalAssetsToBucket(options: {
  /** Report what would happen and write nothing. */
  dryRun: boolean;
  /** Stop after this many, for a first cautious pass. */
  limit?: number;
}): Promise<MigrationReport> {
  const report: MigrationReport = {
    looked: 0,
    copied: 0,
    skipped: 0,
    missing: 0,
    failed: 0,
    bytes: 0,
    problems: [],
    lines: [],
  };

  if (!s3Config()) {
    report.problems.push('No bucket is configured. Set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY and S3_REGION first.');
    return report;
  }

  const assets = await db.asset.findMany({
    where: { storageKey: { not: '' } },
    orderBy: { createdAt: 'asc' },
    ...(options.limit ? { take: options.limit } : {}),
    select: { id: true, storageKey: true, mimeType: true, name: true, sizeBytes: true },
  });

  for (const asset of assets) {
    report.looked += 1;
    const key = asset.storageKey;

    try {
      // Already there from an earlier run, or uploaded straight to the bucket.
      const existing = await statObject(key);
      if (existing) {
        report.skipped += 1;
        continue;
      }

      const path = localPathFor(key);
      const info = await stat(path).catch(() => null);
      if (!info) {
        report.missing += 1;
        report.problems.push(`${asset.name}: nothing on disk at ${key}`);
        continue;
      }
      if (info.size > MAX_SINGLE_PUT) {
        report.failed += 1;
        report.problems.push(
          `${asset.name}: ${info.size} bytes is too large for a single upload. Copy this one with rclone or the bucket's own tool.`,
        );
        continue;
      }

      if (options.dryRun) {
        report.lines.push(`would copy ${key} (${info.size} bytes)`);
        report.copied += 1;
        report.bytes += info.size;
        continue;
      }

      const body = await readFile(path);
      await uploadOne(key, body, asset.mimeType ?? 'application/octet-stream');

      // Read it back rather than trusting the 200, since a bucket that
      // accepted the request and stored nothing is the failure that hurts.
      const landed = await statObject(key);
      if (!landed) throw new Error('the bucket accepted it but does not have it');

      report.copied += 1;
      report.bytes += info.size;
      report.lines.push(`copied ${key} (${info.size} bytes)`);
    } catch (err) {
      report.failed += 1;
      report.problems.push(`${asset.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return report;
}

export function formatMigration(report: MigrationReport): string {
  const mb = (report.bytes / (1024 * 1024)).toFixed(1);
  const head = [
    `looked at ${report.looked}`,
    `copied ${report.copied} (${mb} MB)`,
    `already there ${report.skipped}`,
    `missing on disk ${report.missing}`,
    `failed ${report.failed}`,
  ].join(', ');

  const problems = report.problems.length > 0 ? `\n\nProblems:\n  ${report.problems.join('\n  ')}` : '';
  return `${head}${problems}`;
}
