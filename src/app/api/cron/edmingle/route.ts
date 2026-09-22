import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authorizeCron } from '@/lib/cron';
import { runEdmingleAuto } from '@/lib/migrate-edmingle-auto';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The Edmingle import on its own schedule.
 *
 * The five-minute messaging job gives the import whatever is left of its
 * minute, which is a duty cycle of about one in eight: a library of six
 * thousand documents takes days that way. Pointing a one-minute cron at
 * this route gives it most of every minute instead. Both schedules may run
 * at once; the lease inside the runner sees to it that only one of them
 * does any work, so adding this job needs no change to the other.
 *
 *   * * * * *  curl -s "https://<host>/api/cron/edmingle?key=<CRON_SECRET>"
 *
 * Does nothing while the switch on the Migration page is off.
 */
export async function GET(request: Request) {
  const auth = authorizeCron(request);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  const started = Date.now();
  const organizations = await db.organization.findMany({ select: { id: true, name: true } });
  const results: Record<string, string> = {};
  for (const organization of organizations) {
    const left = 50_000 - (Date.now() - started);
    if (left < 10_000) {
      results[organization.name] = 'skipped, out of time this run';
      continue;
    }
    const line = await runEdmingleAuto(organization.id, left).catch((err: unknown) => (err instanceof Error ? err.message : String(err)));
    if (line) results[organization.name] = line;
  }
  return NextResponse.json({ ok: true, ms: Date.now() - started, results });
}
