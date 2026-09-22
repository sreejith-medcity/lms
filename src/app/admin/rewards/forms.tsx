'use client';

import { useActionState, useState, useTransition } from 'react';
import { cancelVoucher, issueVouchers, saveAchievement, saveStampScheme, toggleAchievement, toggleStampScheme, type IssueState } from '@/server/rewards';
import type { ActionState } from '@/server/courses';
import { ACHIEVEMENT_RULES } from '@/lib/reward-rules';
import { Button, Field, FormError, FormSuccess, Input, Select, Textarea } from '@/components/ui';

const initial: ActionState = {};

export interface CourseOption {
  id: string;
  title: string;
}

export interface SchemeRow {
  id: string;
  name: string;
  stampsNeeded: number;
  earn: 'CLASS_ATTENDED' | 'LESSON_FINISHED' | 'PURCHASE';
  productId: string | null;
  reward: 'POINTS' | 'VOUCHER';
  rewardPoints: number;
  voucherKind: 'PERCENT' | 'FLAT' | null;
  /** Rupees for FLAT, percent for PERCENT: the form's units, not the row's. */
  voucherValue: number | null;
  voucherDays: number | null;
  isActive: boolean;
}

export interface AchievementRow {
  id: string;
  name: string;
  description: string | null;
  rule: string;
  threshold: number;
  productId: string | null;
  rewardPoints: number;
  voucherKind: 'PERCENT' | 'FLAT' | null;
  voucherValue: number | null;
  voucherDays: number | null;
  isActive: boolean;
}

function CourseSelect({ courses, defaultValue, hint }: { courses: CourseOption[]; defaultValue: string; hint?: string }) {
  return (
    <Field label="Course" hint={hint ?? 'Leave open to count any course.'}>
      <Select name="productId" defaultValue={defaultValue}>
        <option value="">Any course</option>
        {courses.map((c) => (
          <option key={c.id} value={c.id}>
            {c.title}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function VoucherFields({ kind, value, days, required }: { kind: 'PERCENT' | 'FLAT' | null; value: number | null; days: number | null; required: boolean }) {
  const [k, setK] = useState<'PERCENT' | 'FLAT' | ''>(kind ?? (required ? 'PERCENT' : ''));
  return (
    <>
      <Field label="Voucher" hint={required ? undefined : 'Optional, on top of the points.'}>
        <Select name="voucherKind" value={k} onChange={(e) => setK(e.target.value as 'PERCENT' | 'FLAT' | '')}>
          {!required && <option value="">No voucher</option>}
          <option value="PERCENT">A percentage off</option>
          <option value="FLAT">An amount off</option>
        </Select>
      </Field>
      <Field label={k === 'FLAT' ? 'Amount (rupees)' : 'Percent off'}>
        <Input name="voucherValue" type="number" min={0} max={k === 'FLAT' ? 10000000 : 100} step="1" defaultValue={value ?? ''} disabled={!k} />
      </Field>
      <Field label="Voucher valid for (days)" hint="Blank means it never expires.">
        <Input name="voucherDays" type="number" min={1} max={3650} defaultValue={days ?? 90} disabled={!k} />
      </Field>
    </>
  );
}

export function SchemeForm({ draft, courses, onDone }: { draft: SchemeRow | null; courses: CourseOption[]; onDone?: () => void }) {
  const [state, action, pending] = useActionState(saveStampScheme, initial);
  const [reward, setReward] = useState<'POINTS' | 'VOUCHER'>(draft?.reward ?? 'POINTS');
  return (
    <form action={action} className="space-y-4">
      {draft && <input type="hidden" name="id" value={draft.id} />}
      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" hint="As it reads on the card: 'Eight classes, the ninth free'.">
          <Input name="name" defaultValue={draft?.name ?? ''} required maxLength={80} />
        </Field>
        <Field label="A stamp for each" hint="What earns a stamp.">
          <Select name="earn" defaultValue={draft?.earn ?? 'CLASS_ATTENDED'}>
            <option value="CLASS_ATTENDED">Class attended</option>
            <option value="LESSON_FINISHED">Lesson finished</option>
            <option value="PURCHASE">Course bought</option>
          </Select>
        </Field>
        <Field label="Stamps to fill the card">
          <Input name="stampsNeeded" type="number" min={1} max={100} defaultValue={draft?.stampsNeeded ?? 8} required />
        </Field>
        <CourseSelect courses={courses} defaultValue={draft?.productId ?? ''} />
        <Field label="A full card earns">
          <Select name="reward" value={reward} onChange={(e) => setReward(e.target.value as 'POINTS' | 'VOUCHER')}>
            <option value="POINTS">Points</option>
            <option value="VOUCHER">A voucher</option>
          </Select>
        </Field>
        {reward === 'POINTS' ? (
          <Field label="Points" hint="Spent at checkout like any other points.">
            <Input name="rewardPoints" type="number" min={1} max={100000} defaultValue={draft?.rewardPoints || 500} />
          </Field>
        ) : (
          <VoucherFields kind={draft?.voucherKind ?? 'PERCENT'} value={draft?.voucherValue ?? null} days={draft?.voucherDays ?? 90} required />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving...' : draft ? 'Save card' : 'Add card'}
        </Button>
        {onDone && (
          <button type="button" className="t-small faint hover:underline" onClick={onDone}>
            Close
          </button>
        )}
      </div>
    </form>
  );
}

export function SchemeToggle({ id, isActive }: { id: string; isActive: boolean }) {
  const [busy, start] = useTransition();
  const [state, setState] = useState<ActionState>({});
  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => start(async () => setState(await toggleStampScheme(id, !isActive)))}>
        {busy ? '...' : isActive ? 'Pause' : 'Resume'}
      </Button>
      {state.error && <span className="t-small text-[var(--bad)]">{state.error}</span>}
    </span>
  );
}

export function AchievementForm({ draft, courses, onDone }: { draft: AchievementRow | null; courses: CourseOption[]; onDone?: () => void }) {
  const [state, action, pending] = useActionState(saveAchievement, initial);
  const [rule, setRule] = useState(draft?.rule ?? 'COURSE_COMPLETED');
  const def = ACHIEVEMENT_RULES.find((r) => r.rule === rule);
  return (
    <form action={action} className="space-y-4">
      {draft && <input type="hidden" name="id" value={draft.id} />}
      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <Input name="name" defaultValue={draft?.name ?? ''} required maxLength={80} />
        </Field>
        <Field label="What earns it" hint={def?.how}>
          <Select name="rule" value={rule} onChange={(e) => setRule(e.target.value)}>
            {ACHIEVEMENT_RULES.map((r) => (
              <option key={r.rule} value={r.rule}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>
        {def?.thresholdLabel && (
          <Field label={def.thresholdLabel}>
            <Input key={rule} name="threshold" type="number" min={1} max={rule === 'PASSED_FIRST_ATTEMPT' ? 100 : 100000} defaultValue={draft?.rule === rule ? draft.threshold : rule === 'PASSED_FIRST_ATTEMPT' ? 60 : rule === 'STREAK_DAYS' ? 30 : 8} required />
          </Field>
        )}
        <CourseSelect courses={courses} defaultValue={draft?.productId ?? ''} />
        <Field label="Points" hint="Zero for none.">
          <Input name="rewardPoints" type="number" min={0} max={100000} defaultValue={draft?.rewardPoints ?? 0} />
        </Field>
        <VoucherFields kind={draft?.voucherKind ?? null} value={draft?.voucherValue ?? null} days={draft?.voucherDays ?? null} required={false} />
        <div className="sm:col-span-2">
          <Field label="Shown to the learner as" hint="One line under the name. Optional.">
            <Textarea name="description" rows={2} maxLength={300} defaultValue={draft?.description ?? ''} />
          </Field>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving...' : draft ? 'Save achievement' : 'Add achievement'}
        </Button>
        {onDone && (
          <button type="button" className="t-small faint hover:underline" onClick={onDone}>
            Close
          </button>
        )}
      </div>
    </form>
  );
}

export function AchievementToggle({ id, isActive }: { id: string; isActive: boolean }) {
  const [busy, start] = useTransition();
  const [state, setState] = useState<ActionState>({});
  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => start(async () => setState(await toggleAchievement(id, !isActive)))}>
        {busy ? '...' : isActive ? 'Pause' : 'Resume'}
      </Button>
      {state.error && <span className="t-small text-[var(--bad)]">{state.error}</span>}
    </span>
  );
}

export function EditableRow({ label, children, form }: { label: React.ReactNode; children?: React.ReactNode; form: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="py-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">{label}</div>
        {children}
        <button type="button" className="t-small underline-offset-2 hover:underline" onClick={() => setOpen((o) => !o)}>
          {open ? 'Close' : 'Edit'}
        </button>
      </div>
      {open && <div className="mt-3 rounded-lg border p-3">{form(() => setOpen(false))}</div>}
    </li>
  );
}

export function IssueForm({ courses, claimBase }: { courses: CourseOption[]; claimBase: string }) {
  const [state, action, pending] = useActionState(issueVouchers, initial as IssueState);
  const [mode, setMode] = useState<'learner' | 'batch'>('learner');
  const [kind, setKind] = useState<'PERCENT' | 'FLAT'>('PERCENT');
  const csv = state.codes?.length ? `data:text/csv;charset=utf-8,${encodeURIComponent(['code,claim link', ...state.codes.map((c) => `${c},${claimBase}?code=${c}`)].join('\n'))}` : null;
  return (
    <form action={action} className="space-y-4">
      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />
      {state.ok && state.codes && state.codes.length > 1 && csv && (
        <p className="t-small">
          <a href={csv} download={`vouchers-${(state.batchLabel ?? 'batch').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`} className="underline">
            Download the codes with their claim links
          </a>
          , for printing as QR codes.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="For">
          <Select name="mode" value={mode} onChange={(e) => setMode(e.target.value as 'learner' | 'batch')}>
            <option value="learner">One learner, by name</option>
            <option value="batch">A printed batch, claimed by whoever scans it</option>
          </Select>
        </Field>
        {mode === 'learner' ? (
          <Field label="Learner" hint="Registration number, email or mobile; or scan their card into the box.">
            <Input name="learner" autoComplete="off" />
          </Field>
        ) : (
          <>
            <Field label="How many">
              <Input name="count" type="number" min={1} max={500} defaultValue={20} />
            </Field>
            <Field label="Batch label" hint="Where they are going: 'Open day, October'.">
              <Input name="batchLabel" maxLength={80} />
            </Field>
          </>
        )}
        <Field label="Worth">
          <Select name="kind" value={kind} onChange={(e) => setKind(e.target.value as 'PERCENT' | 'FLAT')}>
            <option value="PERCENT">A percentage off</option>
            <option value="FLAT">An amount off</option>
          </Select>
        </Field>
        <Field label={kind === 'FLAT' ? 'Amount (rupees)' : 'Percent off'}>
          <Input key={kind} name="value" type="number" min={1} max={kind === 'FLAT' ? 10000000 : 100} step="1" defaultValue={kind === 'FLAT' ? 500 : 10} required />
        </Field>
        {kind === 'PERCENT' && (
          <Field label="Up to (rupees)" hint="A cap on a percentage voucher. Blank for none.">
            <Input name="maxDiscountRupees" type="number" min={0} step="1" />
          </Field>
        )}
        <CourseSelect courses={courses} defaultValue="" hint="Spendable on this course only. Leave open for anything." />
        <Field label="Expires on" hint="Blank means never.">
          <Input name="expiresOn" type="date" />
        </Field>
        <Field label="Note" hint="For the office. Optional.">
          <Input name="note" maxLength={200} />
        </Field>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? 'Issuing...' : mode === 'learner' ? 'Issue voucher' : 'Print vouchers'}
      </Button>
    </form>
  );
}

export function CancelVoucher({ id }: { id: string }) {
  const [busy, start] = useTransition();
  const [state, setState] = useState<ActionState>({});
  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => start(async () => setState(await cancelVoucher(id)))}>
        {busy ? '...' : 'Cancel'}
      </Button>
      {state.error && <span className="t-small text-[var(--bad)]">{state.error}</span>}
    </span>
  );
}
