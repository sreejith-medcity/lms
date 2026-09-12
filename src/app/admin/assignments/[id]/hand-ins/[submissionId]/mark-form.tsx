'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { gradeHandIn } from '@/server/assignments';
import type { ActionState } from '@/server/courses';
import { Button, Card, Field, FormError, FormSuccess, Input, Textarea } from '@/components/ui';
import { trimNumber } from '@/lib/assignment-rules';

const initial: ActionState = {};

export function MarkForm({
  submissionId,
  maxMarks,
  marks,
  feedback,
  alreadyMarked,
}: {
  submissionId: string;
  maxMarks: number;
  marks: number | null;
  feedback: string;
  alreadyMarked: boolean;
}) {
  const [state, action, pending] = useActionState(gradeHandIn, initial);
  const router = useRouter();

  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);

  return (
    <Card>
      <form action={action} className="space-y-4">
        <input type="hidden" name="submissionId" value={submissionId} />
        <FormError message={state.error} />
        <FormSuccess message={state.ok ? state.message : undefined} />

        <Field label={`Mark, out of ${trimNumber(maxMarks)}`}>
          <Input name="marks" type="number" min={0} max={maxMarks} step="0.5" defaultValue={marks ?? ''} inputMode="decimal" />
        </Field>
        <Field label="Feedback" hint="What was good, what to fix. The learner reads this word for word.">
          <Textarea name="feedback" rows={6} maxLength={10_000} defaultValue={feedback} />
        </Field>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" name="decision" value="GRADE" disabled={pending}>
            {pending ? 'Saving...' : alreadyMarked ? 'Save the mark' : 'Mark it'}
          </Button>
          <Button type="submit" name="decision" value="RETURN" variant="secondary" disabled={pending}>
            Return for another go
          </Button>
        </div>
        <p className="t-small faint">Returning it sends the feedback without a mark and lets the learner hand in again whatever the assignment's rule.</p>
      </form>
    </Card>
  );
}
