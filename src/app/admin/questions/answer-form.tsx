'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { answerQuestion, setQuestionHidden, setQuestionPinned } from '@/server/lesson-questions';
import type { ActionState } from '@/server/courses';
import { Button, Checkbox, FormError, Textarea } from '@/components/ui';
import { ANSWER_MAX } from '@/lib/lesson-qa';

const initial: ActionState = {};

/**
 * One question, answered in place. The trainer never leaves the queue: the
 * form opens under the question, the answer goes, the row moves down to the
 * answered half of the page.
 */
export function AnswerForm({
  questionId,
  answer,
  isPinned,
  isHidden,
  canEdit,
}: {
  questionId: string;
  answer: string | null;
  isPinned: boolean;
  isHidden: boolean;
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(!answer);
  const [state, action, pending] = useActionState(answerQuestion, initial);
  const [busy, startTransition] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const router = useRouter();

  if (state.ok) setTimeout(() => router.refresh(), 0);

  function run(fn: () => Promise<ActionState>) {
    setProblem(null);
    startTransition(async () => {
      const result = await fn();
      if (result.error) setProblem(result.error);
      else router.refresh();
    });
  }

  if (!canEdit) return null;

  return (
    <div className="mt-3 space-y-2">
      {open ? (
        <form action={action} className="space-y-2">
          <input type="hidden" name="questionId" value={questionId} />
          <FormError message={state.error} />
          <Textarea
            name="answer"
            rows={4}
            maxLength={ANSWER_MAX}
            defaultValue={answer ?? ''}
            placeholder="Answer here. Everyone waiting on it is told; the batch sees it under the lesson."
            required
          />
          <div className="flex flex-wrap items-center gap-3">
            <Checkbox
              name="pin"
              label="Pin to the top of the lesson"
              hint="For a question the next batch will ask too."
              defaultChecked={isPinned}
            />
            <div className="ml-auto flex gap-2">
              {answer && (
                <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
                  Cancel
                </Button>
              )}
              <Button type="submit" disabled={pending}>
                {pending ? 'Sending…' : answer ? 'Update the answer' : 'Answer'}
              </Button>
            </div>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
            Edit the answer
          </Button>
          <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => run(() => setQuestionPinned(questionId, !isPinned))}>
            {isPinned ? 'Unpin' : 'Pin'}
          </Button>
          <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => run(() => setQuestionHidden(questionId, !isHidden))}>
            {isHidden ? 'Show to the batch again' : 'Hide from the batch'}
          </Button>
        </div>
      )}
      {open && (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => run(() => setQuestionHidden(questionId, !isHidden))} className="t-small underline faint">
            {isHidden ? 'Show to the batch again' : 'Hide from the batch'}
          </button>
        </div>
      )}
      {problem && <FormError message={problem} />}
    </div>
  );
}
