'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addPrerequisite, removePrerequisite } from '@/server/learning-paths';
import type { ActionState } from '@/server/courses';
import { Button, Card, Field, FormError, FormSuccess, Input, Select } from '@/components/ui';
import { prerequisiteLabel } from '@/lib/learning-paths';

const initial: ActionState = {};

export interface PrerequisiteView {
  requiredCourseId: string;
  requiredTitle: string;
  minProgressPercent: number;
}

/**
 * "Finish A1 first." A prerequisite stops the course being sold to a learner
 * who has not got through what comes before it; the office can still enrol
 * anyone by hand. The course page says what is needed and links to it.
 */
export function PrerequisitesForm({
  courseId,
  prerequisites,
  unlocks,
  candidates,
  canEdit,
}: {
  courseId: string;
  prerequisites: PrerequisiteView[];
  /** Courses that list this one as a prerequisite: where the path goes next. */
  unlocks: { title: string; href: string }[];
  candidates: { courseId: string; title: string }[];
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState(addPrerequisite, initial);
  const [busy, start] = useTransition();
  const [problem, setProblem] = useState<string>();
  const [percent, setPercent] = useState(100);
  const router = useRouter();

  if (state.ok) setTimeout(() => router.refresh(), 0);

  const taken = new Set(prerequisites.map((p) => p.requiredCourseId));
  const options = candidates.filter((c) => c.courseId !== courseId && !taken.has(c.courseId));

  return (
    <Card>
      <h2 className="t-heading">Comes after</h2>
      <p className="t-small muted mt-1 max-w-prose">
        What a learner must have done before this course is sold to them. It draws the path on
        the course page (&quot;Finish A1 to unlock A2&quot;) and refuses checkout until it is met.
        Enrolling somebody from the office ignores it.
      </p>

      {prerequisites.length > 0 && (
        <ul className="mt-4 divide-y rounded-[var(--radius-sm)] border">
          {prerequisites.map((p) => (
            <li key={p.requiredCourseId} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className="t-small font-medium">{prerequisiteLabel(p)}</span>
              {canEdit && (
                <button
                  type="button"
                  disabled={busy}
                  className="t-small ml-auto underline"
                  style={{ color: 'var(--bad)' }}
                  onClick={() =>
                    start(async () => {
                      const r = await removePrerequisite(courseId, p.requiredCourseId);
                      setProblem(r.error);
                      if (!r.error) router.refresh();
                    })
                  }
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {problem && <FormError message={problem} />}

      {canEdit && options.length > 0 && (
        <form action={action} className="mt-4 space-y-3">
          <input type="hidden" name="courseId" value={courseId} />
          <FormError message={state.error} />
          <FormSuccess message={state.ok ? state.message : undefined} />
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
            <Field label="Course that comes first">
              <Select name="requiredCourseId" defaultValue="" required>
                <option value="" disabled>
                  Pick a course
                </option>
                {options.map((c) => (
                  <option key={c.courseId} value={c.courseId}>
                    {c.title}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Must be this far through" hint="100 means finished.">
              <span className="flex items-center gap-2">
                <Input
                  name="minProgressPercent"
                  type="number"
                  min={0}
                  max={100}
                  step={5}
                  value={percent}
                  onChange={(e) => setPercent(Number(e.target.value))}
                  className="w-24"
                />
                <span className="t-small faint">%</span>
              </span>
            </Field>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Add'}
            </Button>
          </div>
        </form>
      )}

      {unlocks.length > 0 && (
        <p className="t-small faint mt-4">
          Finishing this course unlocks{' '}
          {unlocks.map((u, i) => (
            <span key={u.href}>
              {i > 0 && (i === unlocks.length - 1 ? ' and ' : ', ')}
              <a href={u.href} className="underline">
                {u.title}
              </a>
            </span>
          ))}
          .
        </p>
      )}
    </Card>
  );
}
