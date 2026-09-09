'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useActionState, useState, useTransition } from 'react';
import { markHoliday, clearHoliday } from '@/server/sessions';
import type { ActionState } from '@/server/courses';
import {
  Button,
  Card,
  Field,
  FormError,
  FormSuccess,
  Input,
  Select,
} from '@/components/ui';

const VIEWS = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'list', label: 'List' },
] as const;

export function CalendarControls({
  view,
  label,
  prev,
  next,
  today,
  batchId,
  trainerId,
  batches,
  trainers,
}: {
  view: string;
  label: string;
  prev: string;
  next: string;
  today: string;
  batchId: string;
  trainerId: string;
  batches: { id: string; name: string }[];
  trainers: { id: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  function href(changes: Record<string, string>) {
    const params = new URLSearchParams(search.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    return `${pathname}?${params.toString()}`;
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1">
        <Link
          href={href({ date: prev })}
          aria-label="Previous"
          className="grid h-9 w-9 place-items-center rounded-[var(--radius-sm)] border hover:bg-[var(--surface-2)]"
        >
          ‹
        </Link>
        <Link
          href={href({ date: next })}
          aria-label="Next"
          className="grid h-9 w-9 place-items-center rounded-[var(--radius-sm)] border hover:bg-[var(--surface-2)]"
        >
          ›
        </Link>
        <Link
          href={href({ date: today })}
          className="ml-1 rounded-[var(--radius-sm)] border px-3 py-1.5 text-sm hover:bg-[var(--surface-2)]"
        >
          Today
        </Link>
      </div>

      <h2 className="t-heading min-w-48 flex-1">{label}</h2>

      <div className="flex rounded-[var(--radius-sm)] border p-0.5">
        {VIEWS.map((v) => (
          <Link
            key={v.value}
            href={href({ view: v.value })}
            aria-current={view === v.value ? 'page' : undefined}
            className={`rounded-[calc(var(--radius-sm)-2px)] px-3 py-1.5 text-sm transition ${
              view === v.value
                ? 'bg-[var(--brand)] font-medium text-[var(--brand-ink)]'
                : 'text-[var(--ink-2)] hover:bg-[var(--surface-2)]'
            }`}
          >
            {v.label}
          </Link>
        ))}
      </div>

      <div className="w-44">
        <Select
          value={batchId}
          aria-label="Batch"
          onChange={(e) => router.push(href({ batch: e.target.value }))}
        >
          <option value="">All batches</option>
          {batches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="w-44">
        <Select
          value={trainerId}
          aria-label="Trainer"
          onChange={(e) => router.push(href({ trainer: e.target.value }))}
        >
          <option value="">All trainers</option>
          {trainers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}

const initial: ActionState = {};

export function HolidayForm({
  batches,
  defaultDate,
  scopedBatchId,
}: {
  batches: { id: string; name: string }[];
  defaultDate: string;
  scopedBatchId: string;
}) {
  const [state, action, pending] = useActionState(markHoliday, initial);
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(defaultDate);
  const [to, setTo] = useState('');
  const [batch, setBatch] = useState(scopedBatchId);
  const [undoing, startUndo] = useTransition();
  const [undo, setUndo] = useState<ActionState>({});

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Mark a holiday
      </Button>
    );
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="t-heading">Mark a holiday</h2>
          <p className="t-small muted mt-1 max-w-prose">
            Classes on these days are called off and flagged as a holiday, so they stop counting
            against anyone&apos;s attendance and the learner sees why.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>

      <form action={action} className="mt-4 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="From">
            <Input
              type="date"
              name="fromDate"
              required
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </Field>
          <Field label="To" hint="Blank for one day.">
            <Input type="date" name="toDate" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Field label="Batch" hint="Blank means the whole academy.">
            <Select name="batchId" value={batch} onChange={(e) => setBatch(e.target.value)}>
              <option value="">Every batch</option>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reason">
            <Input name="reason" placeholder="Onam" maxLength={120} />
          </Field>
        </div>

        <FormError message={state.error ?? undo.error} />
        <FormSuccess message={state.ok ? state.message : undo.ok ? undo.message : undefined} />

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? 'Marking…' : 'Mark holiday'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={undoing || !from}
            title="Puts classes on these days back on the timetable"
            onClick={() =>
              startUndo(async () => setUndo(await clearHoliday(from, to || null, batch || null)))
            }
          >
            {undoing ? 'Undoing…' : 'Put these days back'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
