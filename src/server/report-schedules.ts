'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import { permissionFor, reportById } from '@/lib/reports';
import { RANGE_CHOICES, nextRun, parseRecipients, type Cadence } from '@/lib/report-schedules';
import { runDueReportSchedules } from '@/lib/report-schedules-run';
import type { ActionState } from '@/server/courses';

/**
 * Scheduled reports: a report, a cadence, and who gets the file. Managed by
 * anyone who can edit that report's category; the office decides who the
 * branch heads are, not the branch heads.
 */

const PAGE = '/admin/analytics/reports/schedules';

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  console.error('[report-schedules]', message);
  return { error: 'Something went wrong. Please try again.' };
}

export async function saveReportSchedule(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const tenant = await requireTenant();
    const id = String(formData.get('id') ?? '');
    const reportId = String(formData.get('reportId') ?? '');
    const report = reportById(reportId);
    if (!report) return { error: 'Pick a report.' };
    const user = await requireStaff(permissionFor(report), 'edit');

    const name = String(formData.get('name') ?? '').trim() || report.title;
    const cadenceRaw = String(formData.get('cadence') ?? 'WEEKLY');
    const cadence: Cadence = cadenceRaw === 'DAILY' || cadenceRaw === 'MONTHLY' ? cadenceRaw : 'WEEKLY';
    const dayOfWeek = Math.max(1, Math.min(7, Math.round(Number(formData.get('dayOfWeek') ?? 1)) || 1));
    const dayOfMonth = Math.max(1, Math.min(28, Math.round(Number(formData.get('dayOfMonth') ?? 1)) || 1));
    const hourLocal = Math.max(0, Math.min(23, Math.round(Number(formData.get('hourLocal') ?? 8)) || 0));
    const rangeRaw = Number(formData.get('rangeDays') ?? 30);
    const rangeDays = RANGE_CHOICES.includes(rangeRaw as (typeof RANGE_CHOICES)[number]) ? rangeRaw : 30;
    const { emails, problems } = parseRecipients(String(formData.get('recipients') ?? ''));
    if (problems.length > 0) return { error: `Not an email: ${problems.slice(0, 3).join(', ')}.` };
    if (emails.length === 0) return { error: 'Add at least one email to send it to.' };

    const shape = { cadence, dayOfWeek, dayOfMonth, hourLocal };
    const nextRunAt = nextRun(shape, new Date(), tenant.timezone);
    const data = { reportId, name, ...shape, rangeDays, recipients: emails, nextRunAt };

    if (id) {
      const changed = await db.reportSchedule.updateMany({ where: { id, organizationId: tenant.organizationId }, data });
      if (changed.count === 0) return { error: 'Schedule not found.' };
      await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'report_schedule.update', entity: 'ReportSchedule', entityId: id, after: { reportId, cadence, recipients: emails.length } });
    } else {
      const row = await db.reportSchedule.create({ data: { organizationId: tenant.organizationId, createdById: user.id, ...data }, select: { id: true } });
      await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'report_schedule.create', entity: 'ReportSchedule', entityId: row.id, after: { reportId, cadence, recipients: emails.length } });
    }
    revalidatePath(PAGE);
    return { ok: true, message: id ? 'Saved.' : 'Scheduled.' };
  } catch (err) {
    return fail(err);
  }
}

async function scheduleGuard(id: string, action: 'edit' | 'delete') {
  const tenant = await requireTenant();
  const row = await db.reportSchedule.findFirst({ where: { id, organizationId: tenant.organizationId }, select: { id: true, reportId: true, isActive: true } });
  if (!row) throw new Error('NOT_FOUND');
  const report = reportById(row.reportId);
  const user = await requireStaff(report ? permissionFor(report) : 'reports.sales_reports', action);
  return { tenant, row, user };
}

export async function setReportScheduleActive(id: string, isActive: boolean): Promise<ActionState> {
  try {
    const { tenant, row, user } = await scheduleGuard(id, 'edit');
    await db.reportSchedule.update({ where: { id: row.id }, data: { isActive } });
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: isActive ? 'report_schedule.resume' : 'report_schedule.pause', entity: 'ReportSchedule', entityId: id });
    revalidatePath(PAGE);
    return { ok: true, message: isActive ? 'Resumed.' : 'Paused.' };
  } catch (err) {
    if (err instanceof Error && err.message === 'NOT_FOUND') return { error: 'Schedule not found.' };
    return fail(err);
  }
}

export async function deleteReportSchedule(id: string): Promise<ActionState> {
  try {
    const { tenant, row, user } = await scheduleGuard(id, 'delete');
    await db.reportSchedule.delete({ where: { id: row.id } });
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'report_schedule.delete', entity: 'ReportSchedule', entityId: id });
    revalidatePath(PAGE);
    return { ok: true, message: 'Removed.' };
  } catch (err) {
    if (err instanceof Error && err.message === 'NOT_FOUND') return { error: 'Schedule not found.' };
    return fail(err);
  }
}

/** Send it now, without waiting for the hour: the schedule is pulled forward and run as it stands. */
export async function runReportScheduleNow(id: string): Promise<ActionState> {
  try {
    const { tenant, row, user } = await scheduleGuard(id, 'edit');
    const now = new Date();
    // Pull it to now so the runner takes it; the runner puts the next time back from the cadence.
    await db.reportSchedule.update({ where: { id: row.id }, data: { nextRunAt: now, isActive: true } });
    const result = await runDueReportSchedules(tenant.organizationId, now, row.id);
    if (!row.isActive) await db.reportSchedule.update({ where: { id: row.id }, data: { isActive: false } });
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'report_schedule.run', entity: 'ReportSchedule', entityId: id, after: result });
    revalidatePath(PAGE);
    if (result.failed > 0 && result.sent === 0) return { error: 'The report could not be run. Check the log.' };
    return { ok: true, message: 'Sent. It goes out with the next email run.' };
  } catch (err) {
    if (err instanceof Error && err.message === 'NOT_FOUND') return { error: 'Schedule not found.' };
    return fail(err);
  }
}
