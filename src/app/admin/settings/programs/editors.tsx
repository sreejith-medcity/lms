'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveProgram, setProgramActive } from '@/server/programs';
import { RETEST_RULES, STANDARD_CATEGORIES } from '@/lib/programs';
import type { ActionState } from '@/server/courses';
import { Badge, Button, Card, Field, FormError, FormSuccess, Input, Select, Textarea } from '@/components/ui';

const initial: ActionState = {};

export interface ProgramRow {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  levels: string[];
  skills: string[];
  categories: string[];
  passPercent: number | null;
  gradeScaleId: string | null;
  retestRule: 'FIRST' | 'LATEST' | 'BEST';
  rubric: { attendance: number; tests: number; homework: number; bands: { label: string; minPercent: number }[] } | null;
  lateAfterMinutes: number | null;
  onlineAbsentAfterMinutes: number | null;
  isActive: boolean;
  courses: number;
}

interface Scale {
  id: string;
  name: string;
}

export function ProgramCard({ program, scales, canEdit }: { program: ProgramRow; scales: Scale[]; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();

  if (editing) {
    return (
      <Card>
        <ProgramForm program={program} scales={scales} onDone={() => setEditing(false)} />
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{program.name}</p>
            {program.code && <Badge tone="neutral">{program.code}</Badge>}
            {!program.isActive && <Badge tone="warn">retired</Badge>}
          </div>
          {program.description && <p className="t-small muted mt-1">{program.description}</p>}
          <dl className="t-small mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-[auto_1fr]">
            <dt className="faint">Levels</dt>
            <dd>{program.levels.length ? program.levels.join(' → ') : 'none; a batch names its own'}</dd>
            <dt className="faint">Skills</dt>
            <dd>{program.skills.length ? program.skills.join(', ') : 'one score'}</dd>
            <dt className="faint">Kinds of test</dt>
            <dd>{program.categories.join(', ')}</dd>
            <dt className="faint">Pass mark</dt>
            <dd>{program.passPercent != null ? `${program.passPercent}%` : scales.find((s) => s.id === program.gradeScaleId) ? `from the ${scales.find((s) => s.id === program.gradeScaleId)?.name} scale` : 'not set'}</dd>
            <dt className="faint">Retests</dt>
            <dd>{RETEST_RULES.find((r) => r.value === program.retestRule)?.label ?? program.retestRule}</dd>
            <dt className="faint">Overall rating</dt>
            <dd>
              {program.rubric
                ? `attendance ${program.rubric.attendance}%, tests ${program.rubric.tests}%, homework ${program.rubric.homework}%; ${program.rubric.bands.map((b) => `${b.label} from ${b.minPercent}%`).join(', ')}`
                : 'not yet assessed: no rubric approved, so parents see no overall rating'}
            </dd>
            <dt className="faint">Attendance timing</dt>
            <dd>
              {program.lateAfterMinutes != null ? `late after ${program.lateAfterMinutes} min` : 'late after the academy setting'}
              {' · '}
              {program.onlineAbsentAfterMinutes != null ? `online absent after ${program.onlineAbsentAfterMinutes} min` : 'online check time from the academy setting'}
            </dd>
          </dl>
          <p className="t-small faint mt-2 tabular-nums">
            {program.courses} course{program.courses === 1 ? '' : 's'}
          </p>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await setProgramActive(program.id, !program.isActive);
                  setError(res.error);
                  if (!res.error) router.refresh();
                })
              }
            >
              {program.isActive ? 'Retire' : 'Reactivate'}
            </Button>
          </div>
        )}
      </div>
      {error && <p className="t-small mt-2 text-[var(--bad)]">{error}</p>}
    </Card>
  );
}

export function ProgramForm({ program, scales, onDone }: { program?: ProgramRow; scales: Scale[]; onDone?: () => void }) {
  const [state, action, pending] = useActionState(saveProgram, initial);
  const router = useRouter();

  if (state.ok && onDone) {
    setTimeout(() => {
      onDone();
      router.refresh();
    }, 0);
  }

  return (
    <form action={action} className="space-y-4">
      {program && <input type="hidden" name="id" value={program.id} />}
      <FormError message={state.error} />
      {!onDone && <FormSuccess message={state.ok ? state.message : undefined} />}

      <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Field label="Name">
          <Input name="name" defaultValue={program?.name} required maxLength={120} placeholder="German language" />
        </Field>
        <Field label="Code" hint="Optional, short">
          <Input name="code" defaultValue={program?.code ?? ''} maxLength={20} placeholder="DE" />
        </Field>
      </div>

      <Field label="Description">
        <Input name="description" defaultValue={program?.description ?? ''} maxLength={500} />
      </Field>

      <Field label="Levels or modules, in order" hint="Comma-separated. Leave empty when the program has none.">
        <Input name="levels" defaultValue={program?.levels.join(', ') ?? ''} placeholder="A1, A2, B1, B2" />
      </Field>

      <Field label="Skills assessed" hint="Comma-separated. Leave empty for one undivided score.">
        <Input name="skills" defaultValue={program?.skills.join(', ') ?? ''} placeholder="Reading, Writing, Listening, Speaking" />
      </Field>

      <Field label="Kinds of test a teacher may set" hint="Comma-separated, in the order they are offered.">
        <Textarea name="categories" rows={2} defaultValue={program?.categories.join(', ') ?? STANDARD_CATEGORIES.join(', ')} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Pass mark" hint="Percent. Blank means the grading scale decides.">
          <Input type="number" name="passPercent" min={0} max={100} defaultValue={program?.passPercent ?? ''} />
        </Field>
        <Field label="Grading scale">
          <Select name="gradeScaleId" defaultValue={program?.gradeScaleId ?? ''}>
            <option value="">The academy&rsquo;s active scale</option>
            {scales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Retests" hint={RETEST_RULES.find((r) => r.value === (program?.retestRule ?? 'LATEST'))?.help}>
          <Select name="retestRule" defaultValue={program?.retestRule ?? 'LATEST'}>
            {RETEST_RULES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Late after (minutes)" hint="Blank: the academy's attendance setting.">
          <Input type="number" name="lateAfterMinutes" min={0} max={120} defaultValue={program?.lateAfterMinutes ?? ''} />
        </Field>
        <Field label="Online no-show absent after (minutes)" hint="Blank: the academy's attendance setting.">
          <Input type="number" name="onlineAbsentAfterMinutes" min={0} max={180} defaultValue={program?.onlineAbsentAfterMinutes ?? ''} />
        </Field>
      </div>

      <fieldset className="rounded-[var(--radius-sm)] border p-4">
        <legend className="px-1 text-sm font-medium">Overall rating rubric</legend>
        <p className="t-small muted">
          Leave the weights blank and parents see &ldquo;Not yet assessed&rdquo;. Fill them in only once management has approved the rubric. Weights add to 100; a part with no data in the period is left out and the rest rescaled, and the parent&rsquo;s screen says so.
        </p>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <Field label="Attendance %">
            <Input type="number" name="ratingAttendance" min={0} max={100} defaultValue={program?.rubric?.attendance ?? ''} />
          </Field>
          <Field label="Tests %">
            <Input type="number" name="ratingTests" min={0} max={100} defaultValue={program?.rubric?.tests ?? ''} />
          </Field>
          <Field label="Homework %">
            <Input type="number" name="ratingHomework" min={0} max={100} defaultValue={program?.rubric?.homework ?? ''} />
          </Field>
        </div>
        <div className="mt-3">
          <Field label="Bands" hint='"Label:minimum percent", comma-separated, the lowest at 0.'>
            <Input name="ratingBands" defaultValue={program?.rubric ? program.rubric.bands.map((b) => `${b.label}:${b.minPercent}`).join(', ') : ''} placeholder="Excellent:85, Good:70, Satisfactory:50, Needs attention:0" />
          </Field>
        </div>
      </fieldset>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving...' : program ? 'Save program' : 'Add program'}
        </Button>
        {onDone && (
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
