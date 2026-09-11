'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  addQuestionsToAssessment,
  removeQuestionFromAssessment,
  searchBankQuestions,
  setAssessmentCourses,
  updateAssessment,
  type BankQuestionHit,
} from '@/server/assessments';
import { redrawPaper } from '@/server/papers';
import type { ActionState } from '@/server/courses';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Field,
  FormError,
  FormSuccess,
  Input,
  Select,
  Textarea,
} from '@/components/ui';
import { KINDS } from '../editors';

const initial: ActionState = {};

const TYPE_LABELS: Record<string, string> = {
  MCQ_SINGLE: 'Single',
  MCQ_MULTI: 'Multiple',
  TRUE_FALSE: 'True/false',
  SHORT_ANSWER: 'Short written',
  LONG_ANSWER: 'Long written',
};

export function SettingsForm({
  assessment,
}: {
  assessment: {
    id: string;
    title: string;
    kind: string;
    instructions: string | null;
    durationMinutes: number | null;
    maxAttempts: number;
    passPercent: number;
    shuffleQuestions: boolean;
    showResultsImmediately: boolean;
  };
}) {
  const [state, action, pending] = useActionState(updateAssessment, initial);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="id" value={assessment.id} />
      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />

      <Field label="Title">
        <Input name="title" defaultValue={assessment.title} required maxLength={160} />
      </Field>

      <Field label="Kind">
        <Select name="kind" defaultValue={assessment.kind}>
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Minutes" hint="0 = untimed">
          <Input
            name="durationMinutes"
            type="number"
            min={0}
            max={600}
            defaultValue={assessment.durationMinutes ?? 0}
          />
        </Field>
        <Field label="Attempts">
          <Input name="maxAttempts" type="number" min={1} max={20} defaultValue={assessment.maxAttempts} />
        </Field>
        <Field label="Pass %">
          <Input name="passPercent" type="number" min={0} max={100} defaultValue={assessment.passPercent} />
        </Field>
      </div>

      <Field label="Instructions">
        <Textarea name="instructions" rows={3} defaultValue={assessment.instructions ?? ''} maxLength={4000} />
      </Field>

      <Checkbox
        name="shuffleQuestions"
        label="Shuffle the question order"
        defaultChecked={assessment.shuffleQuestions}
      />
      <Checkbox
        name="showResultsImmediately"
        label="Show the score as soon as it is submitted"
        hint="A paper with written answers waits for marking whatever this says."
        defaultChecked={assessment.showResultsImmediately}
      />

      <Button type="submit" disabled={pending}>
        {pending ? 'Saving...' : 'Save settings'}
      </Button>
    </form>
  );
}

export function PaperList({
  assessmentId,
  items,
  locked,
}: {
  assessmentId: string;
  items: { id: string; type: string; prompt: string; marks: number; negative: number; bank: string }[];
  locked: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();

  if (items.length === 0) {
    return (
      <Card>
        <p className="t-small muted">
          Nothing on this paper yet. Pick questions from a bank below.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {error && <p className="t-small text-[var(--bad)]">{error}</p>}
      {items.map((q, i) => (
        <Card key={q.id}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="t-small faint tabular-nums">Q{i + 1}</span>
                <Badge tone="neutral">{TYPE_LABELS[q.type] ?? q.type}</Badge>
                <span className="t-small faint tabular-nums">
                  {q.marks} mark{q.marks === 1 ? '' : 's'}
                  {q.negative > 0 ? `, −${q.negative}` : ''}
                </span>
                <span className="t-micro faint">{q.bank}</span>
              </div>
              <p className="mt-1.5 text-sm">{q.prompt}</p>
            </div>

            {!locked && (
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const res = await removeQuestionFromAssessment(assessmentId, q.id);
                    setError(res.error);
                    if (!res.error) router.refresh();
                  })
                }
              >
                Remove
              </Button>
            )}
          </div>
        </Card>
      ))}

      {locked && (
        <p className="t-small faint">
          Learners have already sat this, so the paper is fixed. Removing a question now would
          rewrite scores that were already earned.
        </p>
      )}
    </div>
  );
}

export function QuestionPicker({
  assessmentId,
  banks,
  chosenCount,
  locked,
}: {
  assessmentId: string;
  banks: { id: string; name: string; count: number }[];
  chosenCount: number;
  locked: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [loading, startLoad] = useTransition();
  const [bankId, setBankId] = useState(banks[0]?.id ?? '');
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const [hits, setHits] = useState<{ rows: BankQuestionHit[]; total: number }>({ rows: [], total: 0 });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string>();

  // Fetched on demand rather than shipped with the page: a bank of three
  // thousand questions is a search box, not a list.
  useEffect(() => {
    if (!bankId || locked) return;
    const handle = setTimeout(() => {
      startLoad(async () => {
        const res = await searchBankQuestions({ bankId, q, tag, excludeAssessmentId: assessmentId });
        if (res.error) setError(res.error);
        setHits({ rows: res.rows, total: res.total });
      });
    }, 250);
    return () => clearTimeout(handle);
  }, [bankId, q, tag, assessmentId, locked, chosenCount]);

  if (locked) return null;

  if (banks.length === 0) {
    return (
      <Card>
        <p className="t-small muted">
          No question banks yet. Questions are written in the bank first, then picked into a
          paper here.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <Field label="Bank">
            <Select value={bankId} onChange={(e) => setBankId(e.target.value)}>
              {banks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.count})
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="min-w-40 flex-1">
          <Field label="Search">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Words in the question" />
          </Field>
        </div>
        <div className="w-36">
          <Field label="Tag">
            <Input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="any" />
          </Field>
        </div>
        <Button
          disabled={pending || picked.size === 0}
          onClick={() =>
            start(async () => {
              const res = await addQuestionsToAssessment(assessmentId, [...picked]);
              setError(res.error);
              if (!res.error) {
                setPicked(new Set());
                router.refresh();
              }
            })
          }
        >
          {pending ? 'Adding...' : `Add ${picked.size || ''}`.trim()}
        </Button>
      </div>

      {error && <p className="t-small mt-2 text-[var(--bad)]">{error}</p>}

      <p className="t-small faint mt-3 tabular-nums">
        {loading ? 'Looking...' : `${hits.total} not yet on the paper${hits.total > hits.rows.length ? `, showing ${hits.rows.length}. Narrow it with a search or a tag.` : '.'}`}
      </p>

      <ul className="mt-2 space-y-1.5">
        {!loading && hits.rows.length === 0 && (
          <li className="t-small faint">Nothing here to add.</li>
        )}
        {hits.rows.map((q) => (
          <li key={q.id}>
            <label className="flex cursor-pointer items-start gap-2.5 rounded-[var(--radius-sm)] px-2 py-1.5 hover:bg-[var(--surface-2)]">
              <input
                type="checkbox"
                checked={picked.has(q.id)}
                onChange={() =>
                  setPicked((prev) => {
                    const next = new Set(prev);
                    if (next.has(q.id)) next.delete(q.id);
                    else next.add(q.id);
                    return next;
                  })
                }
                className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--brand)]"
              />
              <span className="min-w-0">
                <span className="block text-sm">{q.promptHtml}</span>
                <span className="t-micro faint">
                  {TYPE_LABELS[q.type] ?? q.type} · {q.marks} mark{q.marks === 1 ? '' : 's'} ·{' '}
                  {q.difficulty.toLowerCase()}
                  {q.tags.length ? ` · ${q.tags.join(', ')}` : ''}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function CoursePicker({
  assessmentId,
  courses,
  selected,
}: {
  assessmentId: string;
  courses: { id: string; title: string }[];
  selected: string[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [picked, setPicked] = useState<Set<string>>(new Set(selected));
  const [error, setError] = useState<string>();

  return (
    <div className="space-y-3">
      {courses.length === 0 ? (
        <p className="t-small faint">No courses yet.</p>
      ) : (
        <ul className="space-y-1">
          {courses.map((c) => (
            <li key={c.id}>
              <label className="flex cursor-pointer items-center gap-2.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-sm hover:bg-[var(--surface-2)]">
                <input
                  type="checkbox"
                  checked={picked.has(c.id)}
                  onChange={() =>
                    setPicked((prev) => {
                      const next = new Set(prev);
                      if (next.has(c.id)) next.delete(c.id);
                      else next.add(c.id);
                      return next;
                    })
                  }
                  className="h-4 w-4 accent-[var(--brand)]"
                />
                {c.title}
              </label>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="t-small text-[var(--bad)]">{error}</p>}

      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await setAssessmentCourses(assessmentId, [...picked]);
            setError(res.error);
            if (!res.error) router.refresh();
          })
        }
      >
        {pending ? 'Saving...' : 'Save courses'}
      </Button>
    </div>
  );
}

/** Another variant from the same recipe. Only while nobody has sat it. */
export function RedrawButton({ assessmentId }: { assessmentId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState>({});

  return (
    <div className="space-y-1 text-right">
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await redrawPaper(assessmentId);
            setState(res);
            if (res.ok) router.refresh();
          })
        }
      >
        {pending ? 'Drawing...' : 'Draw a fresh variant'}
      </Button>
      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />
    </div>
  );
}
