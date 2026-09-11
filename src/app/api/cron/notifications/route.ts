import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authorizeCron } from '@/lib/cron';
import { drain } from '@/lib/messaging/drain';
import { purgeExpiredOtps } from '@/lib/otp';
import { queueUpcomingReminders } from '@/lib/messaging/reminders';
import { queueFeeReminders } from '@/lib/messaging/fee-reminders';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Sending the outbox.
 *
 * Called on a schedule from outside, because there is no worker process here and
 * pretending otherwise on shared hosting is how a queue silently stops. Runs
 * across every academy on this deployment, one at a time, with a modest batch
 * each so a single busy institute cannot use the whole minute.
 *
 * Safe to call twice. Rows are claimed before they are sent, so an overlapping
 * run finds nothing to do rather than sending everything again.
 */
export async function GET(request: Request) {
  const auth = authorizeCron(request);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  const started = Date.now();
  const organizations = await db.organization.findMany({ select: { id: true, name: true } });

  const results: Record<string, unknown> = {};
  let sent = 0;
  let failed = 0;

  for (const organization of organizations) {
    // Stop before the platform kills the request, so what was sent is recorded
    // rather than lost halfway through.
    if (Date.now() - started > 50_000) {
      results[organization.name] = 'skipped, out of time this run';
      continue;
    }

    // Queue before draining, so a class starting in the next hour is reminded
    // about on this run rather than the next one.
    const reminders = await queueUpcomingReminders(organization.id);
    const fees = await queueFeeReminders(organization.id);
    const result = await drain(organization.id, 100);
    sent += result.sent;
    failed += result.failed;
    results[organization.name] = { ...result, reminders, fees };
  }

  const purged = await purgeExpiredOtps();

  return NextResponse.json({
    ok: true,
    sent,
    failed,
    purgedOtps: purged,
    ms: Date.now() - started,
    results,
  });
}
