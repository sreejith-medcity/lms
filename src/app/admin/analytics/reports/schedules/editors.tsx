'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteReportSchedule, runReportScheduleNow, saveReportSchedule, setReportScheduleActive } from '@/server/report-schedules';
import type { ActionState } from '@/server/courses';
import { Button, Card, Field, FormError, FormSuccess, Input, Select, Textarea } from '@/components/ui';
import { RANGE_CHOICES, rangeLabel } from '@/lib/report-schedules';

const initial: ActionState = {};

export interface ScheduleDraft {
  id: string;
  reportId: string;
  name: string;
  cadence: string;
  dayOfWeek: number;
  dayOfMonth: number;
  hourLocal: number;
  rangeDays: number;
  recipients: string[];
}

export interface ReportChoice {
  id: string;
  title: string;
  category: string;
  ignoresRange: boolean;
}

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function clock(h: number): string {
  return `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'am' : 'pm'}`;
}

export function ScheduleForm({ draft, reports, timezone, presetReportId }: { draft: ScheduleDraft | null; reports: ReportChoice[]; timezone: string; presetReportId?: string }) {
  const [state, action, pending] = useActionState(saveReportSchedule, initial);
  const [reportId, setReportId] = useState(draft?.reportId ?? presetReportId ?? reports[0]?.id ?? '');
  const [cadence, setCadence] = useState(draft?.cadence ?? 'WEEKLY');
  const report = reports.find((r) => r.id === reportId);
  const categories = Array.from(new Set(reports.map((r) => r.category)));

  return (
    <form action={action} className="space-y-4">
      {draft && <input type="hidden" name="id" value={draft.id} />}
      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Report">
          <Select name="reportId" value={reportId} onChange={(e) => setReportId(e.target.value)} required>
            {categories.map((category) => (
              <optgroup key={category} label={category}>
                {reports.filter((r) => r.category === category).map((r) => (
                  <option key={r.id} value={r.id}>{r.title}</option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>
        <Field label="Call it" hint="How it appears in the email subject. The report title if blank.">
          <Input name="name" defaultValue={draft?.name ?? ''} maxLength={120} placeholder={report?.title ?? ''} />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Field label="How often">
          <Select name="cadence" value={cadence} onChange={(e) => setCadence(e.target.value)}>
            <option value="DAILY">Every day</option>
            <option value="WEEKLY">Every week</option>
            <option value="MONTHLY">Every month</option>
          </Select>
        </Field>
        {cadence === 'WEEKLY' && (
          <Field label="On">
            <Select name="dayOfWeek" defaultValue={draft?.dayOfWeek ?? 1}>
              {WEEKDAYS.map((d, i) => (
                <option key={d} value={i + 1}>{d}</option>
              ))}
            </Select>
          </Field>
        )}
        {cadence === 'MONTHLY' && (
          <Field label="On the" hint="Up to the 28th, so no month is skipped.">
            <Select name="dayOfMonth" defaultValue={draft?.dayOfMonth ?? 1}>
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="At" hint={timezone}>
          <Select name="hourLocal" defaultValue={draft?.hourLocal ?? 8}>
            {Array.from({ length: 24 }, (_, h) => h).map((h) => (
              <option key={h} value={h}>{clock(h)}</option>
            ))}
          </Select>
        </Field>
        <Field label="Covering" hint={report?.ignoresRange ? 'This report is the whole book; the range is ignored.' : undefined}>
          <Select name="rangeDays" defaultValue={draft?.rangeDays ?? 30} disabled={report?.ignoresRange}>
            {RANGE_CHOICES.map((d) => (
              <option key={d} value={d}>{rangeLabel(d)}</option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="Send to" hint="One email per line, or separated by commas. Up to 20.">
        <Textarea name="recipients" rows={3} defaultValue={draft?.recipients.join('\n') ?? ''} required placeholder={'head.kochi@example.com\nhead.calicut@example.com'} />
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>{pending ? 'Saving…' : draft ? 'Save changes' : 'Schedule it'}</Button>
        {draft && (
          <a href="/admin/analytics/reports/schedules" className="t-small muted hover:underline">
            Cancel
          </a>
        )}
      </div>
    </form>
  );
}

export function ScheduleActions({ id, isActive }: { id: string; isActive: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);

  const run = (fn: () => Promise<ActionState>) =>
    start(async () => {
      const r = await fn();
      setNote(r.error ?? r.message ?? null);
      if (!r.error) router.refresh();
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <a href={`/admin/analytics/reports/schedules?edit=${id}`} className="rounded-[var(--radius-sm)] border px-2.5 py-1 text-xs hover:bg-[var(--surface-2)]">
        Edit
      </a>
      <button type="button" disabled={pending} onClick={() => run(() => runReportScheduleNow(id))} className="rounded-[var(--radius-sm)] border px-2.5 py-1 text-xs hover:bg-[var(--surface-2)] disabled:opacity-60">
        Send now
      </button>
      <button type="button" disabled={pending} onClick={() => run(() => setReportScheduleActive(id, !isActive))} className="rounded-[var(--radius-sm)] border px-2.5 py-1 text-xs hover:bg-[var(--surface-2)] disabled:opacity-60">
        {isActive ? 'Pause' : 'Resume'}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!window.confirm('Remove this schedule? The files it already sent stay.')) return;
          run(() => deleteReportSchedule(id));
        }}
        className="rounded-[var(--radius-sm)] border px-2.5 py-1 text-xs text-[var(--bad)] hover:bg-[var(--surface-2)] disabled:opacity-60"
      >
        Remove
      </button>
      {note && <span className="t-micro muted">{note}</span>}
    </div>
  );
}
