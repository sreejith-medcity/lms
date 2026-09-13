import Link from 'next/link';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { reportById, reportsByCategory } from '@/lib/reports';
import { describeCadence, rangeLabel } from '@/lib/report-schedules';
import { formatDateTime } from '@/lib/clock';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { ScheduleActions, ScheduleForm, type ReportChoice, type ScheduleDraft } from './editors';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * Reports that send themselves.
 *
 * A branch head who wants collections every Monday should not have to
 * remember to open anything: the file arrives, on the academy's clock,
 * and the last few are kept here so "did it go?" has an answer.
 */
export default async function ReportSchedulesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const tenant = await requireTenant();
  const me = await requireStaff();
  const sp = await searchParams;
  const editId = typeof sp.edit === 'string' ? sp.edit : '';
  const presetReportId = typeof sp.report === 'string' ? sp.report : undefined;

  // Only the reports this person may edit can be scheduled by them.
  const categories = reportsByCategory((permission) => me.permissions[permission]?.edit ?? false);
  const reports: ReportChoice[] = categories.flatMap((c) => c.reports.map((r) => ({ id: r.id, title: r.title, category: c.label, ignoresRange: Boolean(r.ignoresRange) })));
  const allowed = new Set(reports.map((r) => r.id));

  const [schedules, runs] = await Promise.all([
    db.reportSchedule.findMany({
      where: { organizationId: tenant.organizationId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, reportId: true, name: true, cadence: true, dayOfWeek: true, dayOfMonth: true, hourLocal: true, rangeDays: true, recipients: true, isActive: true, lastRunAt: true, nextRunAt: true },
    }),
    db.reportRun.findMany({
      where: { organizationId: tenant.organizationId },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { id: true, reportId: true, fileName: true, rows: true, sentTo: true, createdAt: true, schedule: { select: { name: true } } },
    }),
  ]);

  const editing = schedules.find((s) => s.id === editId && allowed.has(s.reportId));
  const draft: ScheduleDraft | null = editing
    ? { id: editing.id, reportId: editing.reportId, name: editing.name, cadence: editing.cadence, dayOfWeek: editing.dayOfWeek, dayOfMonth: editing.dayOfMonth, hourLocal: editing.hourLocal, rangeDays: editing.rangeDays, recipients: editing.recipients }
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Scheduled reports"
        description="Reports that email themselves as a CSV, on the academy's clock. Each one is kept here for a while after it goes."
        action={
          <Link href="/admin/analytics/reports" className="t-small muted hover:underline">
            All reports
          </Link>
        }
      />

      {reports.length === 0 ? (
        <Card>
          <p className="t-small muted">Your role can open reports but not schedule them. Ask whoever manages roles for edit access to reporting.</p>
        </Card>
      ) : (
        <Card>
          <h2 className="t-heading">{draft ? `Editing: ${draft.name}` : 'Add a schedule'}</h2>
          <div className="mt-4">
            <ScheduleForm key={draft?.id ?? 'new'} draft={draft} reports={reports} timezone={tenant.timezone} presetReportId={presetReportId && allowed.has(presetReportId) ? presetReportId : undefined} />
          </div>
        </Card>
      )}

      <section className="space-y-3">
        <h2 className="t-heading">Schedules</h2>
        {schedules.length === 0 ? (
          <EmptyState title="Nothing scheduled yet" hint="Pick a report above and say who should get it." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {schedules.map((s) => {
              const report = reportById(s.reportId);
              return (
                <Card key={s.id} className={s.isActive ? '' : 'opacity-70'}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{s.name}</p>
                      <p className="t-small muted">{report?.title ?? s.reportId}{report?.ignoresRange ? '' : ` · ${rangeLabel(s.rangeDays)}`}</p>
                    </div>
                    <Badge tone={s.isActive ? 'ok' : 'neutral'}>{s.isActive ? 'On' : 'Paused'}</Badge>
                  </div>
                  <p className="t-small mt-3">{describeCadence(s)}</p>
                  <p className="t-small muted mt-1">
                    To {s.recipients.length === 1 ? s.recipients[0] : `${s.recipients.length} people`}
                  </p>
                  <p className="t-micro faint mt-2">
                    {s.lastRunAt ? `Last sent ${formatDateTime(s.lastRunAt, tenant.timezone)}. ` : 'Not sent yet. '}
                    {s.isActive ? `Next ${formatDateTime(s.nextRunAt, tenant.timezone)}.` : ''}
                  </p>
                  {allowed.has(s.reportId) && (
                    <div className="mt-3">
                      <ScheduleActions id={s.id} isActive={s.isActive} />
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="t-heading">Sent recently</h2>
        {runs.length === 0 ? (
          <p className="t-small muted">Nothing has gone out yet.</p>
        ) : (
          <Card>
            <ul className="divide-y">
              {runs.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div>
                    <p className="t-small font-medium">{r.schedule.name}</p>
                    <p className="t-micro faint">
                      {formatDateTime(r.createdAt, tenant.timezone)} · {r.rows} row{r.rows === 1 ? '' : 's'} · to {r.sentTo.length} {r.sentTo.length === 1 ? 'person' : 'people'}
                    </p>
                  </div>
                  <a href={`/admin/analytics/reports/schedules/runs/${r.id}`} className="rounded-[var(--radius-sm)] border px-2.5 py-1 text-xs hover:bg-[var(--surface-2)]">
                    {r.fileName}
                  </a>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}
