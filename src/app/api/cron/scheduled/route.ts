import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authorizeCron } from '@/lib/cron';
import { provisionMeetings } from '@/lib/zoom-sessions';
import { dispatchWebhooks } from '@/lib/webhooks';
import { sweepScheduledTriggers } from '@/lib/workflows';
import { runDueReportSchedules } from '@/lib/report-schedules-run';
import { runPlatformBilling } from '@/lib/platform/billing';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The housekeeping that has to happen whether anybody is looking or not.
 *
 * Creating Zoom meetings for the classes coming up, and delivering the webhooks
 * somebody else's server was too slow or too down to take the first time.
 *
 * Deliberately separate from the notification run. Sending is time sensitive and
 * should go every few minutes; this is not, and should not be competing for the
 * same minute.
 */
export async function GET(request: Request) {
  const auth = authorizeCron(request);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  const started = Date.now();
  const organizations = await db.organization.findMany({ select: { id: true, name: true } });

  const meetings: Record<string, unknown> = {};
  const sweeps: Record<string, unknown> = {};
  const reports: Record<string, unknown> = {};
  for (const organization of organizations) {
    if (Date.now() - started > 40_000) {
      meetings[organization.name] = 'skipped, out of time this run';
      continue;
    }
    meetings[organization.name] = await provisionMeetings(organization.id, { limit: 25 });
    // The triggers nothing raises on its own: quiet learners, absentees,
    // cold carts. Looked for hourly, which is as often as any of them changes.
    sweeps[organization.name] = await sweepScheduledTriggers(organization.id);
    // The reports somebody asked to have emailed at an hour: run the ones
    // whose hour has come and hand the file to the email queue.
    reports[organization.name] = await runDueReportSchedules(organization.id);
  }

  const webhooks = await dispatchWebhooks(50);

  // Tenant billing: usage counted and renewals, trial ends and pauses decided.
  // Cheap when nothing is due, and safe to run every time this does.
  const billing = await runPlatformBilling().catch((err: unknown) => ({ error: err instanceof Error ? err.message : String(err) }));

  return NextResponse.json({ ok: true, ms: Date.now() - started, meetings, sweeps, reports, webhooks, billing });
}
