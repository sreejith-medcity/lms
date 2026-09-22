import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authorizeCron } from '@/lib/cron';
import { runAsPlatform } from '@/lib/db-scope';
import { provisionMeetings } from '@/lib/zoom-sessions';
import { dispatchWebhooks } from '@/lib/webhooks';
import { sweepScheduledTriggers } from '@/lib/workflows';
import { runDueReportSchedules } from '@/lib/report-schedules-run';
import { runPlatformBilling } from '@/lib/platform/billing';
import { lapsePasses } from '@/lib/passes';
import { expireVouchers, releaseAbandonedVouchers, reviewLastMonthAttendance } from '@/lib/rewards';

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
/** The jobs work for every academy in turn, which is the platform's business, not one host's. */
export function GET(request: Request) {
  return runAsPlatform(() => handle(request));
}

async function handle(request: Request) {
  const auth = authorizeCron(request);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  const started = Date.now();
  const organizations = await db.organization.findMany({ select: { id: true, name: true } });

  const meetings: Record<string, unknown> = {};
  const sweeps: Record<string, unknown> = {};
  const reports: Record<string, unknown> = {};
  const passes: Record<string, unknown> = {};
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
    // Prepaid passes past their validity close, and the place they bought ends.
    passes[organization.name] = await lapsePasses(organization.id).catch((err: unknown) => (err instanceof Error ? err.message : String(err)));
    await expireVouchers(organization.id).catch((err: unknown) => console.error('[cron] vouchers', err instanceof Error ? err.message : err));
    await releaseAbandonedVouchers(organization.id).catch((err: unknown) => console.error('[cron] vouchers', err instanceof Error ? err.message : err));
    await reviewLastMonthAttendance(organization.id).catch((err: unknown) => console.error('[cron] month review', err instanceof Error ? err.message : err));
  }

  const webhooks = await dispatchWebhooks(50);

  // Tenant billing: usage counted and renewals, trial ends and pauses decided.
  // Cheap when nothing is due, and safe to run every time this does.
  const billing = await runPlatformBilling().catch((err: unknown) => ({ error: err instanceof Error ? err.message : String(err) }));

  return NextResponse.json({ ok: true, ms: Date.now() - started, meetings, sweeps, reports, passes, webhooks, billing });
}
