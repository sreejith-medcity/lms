import { db } from '@/lib/db';
import { reportById } from '@/lib/reports';
import { toCsv } from '@/lib/csv';
import { queueNotifications } from '@/lib/notify';
import { organizationOrigin } from '@/lib/org-origin';
import { fileNameFor, nextRun, rangeLabel, windowFor } from '@/lib/report-schedules';

/**
 * The scheduled reports that are due: run each one, keep the file, queue
 * the email with it attached, and set the next time. Called from the
 * housekeeping cron for every academy.
 */
export async function runDueReportSchedules(organizationId: string, now = new Date(), onlyId?: string): Promise<{ sent: number; failed: number }> {
  const [tenant, due] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: { name: true, tenantId: true, timezone: true, currency: true } }),
    db.reportSchedule.findMany({
      where: { organizationId, isActive: true, nextRunAt: { lte: now }, ...(onlyId ? { id: onlyId } : {}) },
      take: 10,
      select: { id: true, reportId: true, name: true, cadence: true, dayOfWeek: true, dayOfMonth: true, hourLocal: true, rangeDays: true, recipients: true },
    }),
  ]);
  if (!tenant || due.length === 0) return { sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;
  const origin = await organizationOrigin(organizationId);

  for (const schedule of due) {
    const next = nextRun(schedule, now, tenant.timezone);
    try {
      const report = reportById(schedule.reportId);
      if (!report) throw new Error(`no report ${schedule.reportId}`);
      const window = windowFor(schedule.rangeDays, now, tenant.timezone);
      const result = await report.run({ organizationId, tenantId: tenant.tenantId, currency: tenant.currency, timeZone: tenant.timezone, since: window.since, days: window.days });
      const covers = report.ignoresRange ? 'everything' : rangeLabel(window.days);
      const preamble: (string | number | null)[][] = [
        [report.title],
        [report.question],
        [`Covers: ${covers}`],
        [`Generated: ${now.toISOString()}`],
        [],
        ...report.definitions.map(([term, meaning]) => [`${term}:`, meaning]),
        [],
      ];
      const csv = toCsv([...preamble, result.columns.map((c) => c.label), ...result.rows]);
      const fileName = fileNameFor(schedule.reportId, now, tenant.timezone);

      const run = await db.reportRun.create({
        data: { organizationId, scheduleId: schedule.id, reportId: schedule.reportId, fileName, csv, rows: result.rows.length, sentTo: schedule.recipients },
        select: { id: true },
      });

      if (schedule.recipients.length > 0) {
        await queueNotifications({
          organizationId,
          eventKey: 'report.scheduled',
          channels: ['EMAIL'],
          recipients: schedule.recipients.map((email) => ({ userId: null, email, phone: null })),
          context: {
            name: 'there',
            item: report.title,
            schedule: schedule.name,
            covers,
            rows: String(result.rows.length),
            academy: tenant.name,
            url: `${origin}/admin/analytics/reports/${schedule.reportId}?range=${window.days}`,
            attachReportRun: run.id,
          },
        });
      }
      await db.reportSchedule.update({ where: { id: schedule.id }, data: { lastRunAt: now, nextRunAt: next } });
      // Keep the last dozen files per schedule; the email already carried the rest.
      const stale = await db.reportRun.findMany({ where: { organizationId, scheduleId: schedule.id }, orderBy: { createdAt: 'desc' }, skip: 12, select: { id: true } });
      if (stale.length > 0) await db.reportRun.deleteMany({ where: { organizationId, id: { in: stale.map((r) => r.id) } } });
      sent += 1;
    } catch (err) {
      console.error('[report-schedules]', schedule.id, err instanceof Error ? err.message : err);
      // Move on rather than retrying every minute forever.
      await db.reportSchedule.update({ where: { id: schedule.id }, data: { nextRunAt: next } }).catch(() => null);
      failed += 1;
    }
  }
  return { sent, failed };
}
