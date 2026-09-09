'use client';

import { useActionState, useState } from 'react';
import { leaveTestimonial } from '@/server/marketing';
import type { ActionState } from '@/server/courses';
import { Button, Card, FormError, FormSuccess, Textarea } from '@/components/ui';

const initial: ActionState = {};

/**
 * Asked only of someone who finished.
 *
 * A review from a learner two lessons in tells nobody anything, and asking for
 * one is how a course page fills up with three-star noise. It arrives
 * unpublished; the academy decides what goes on its own front page.
 */
export function TestimonialForm({
  productId,
  courseTitle,
  existing,
}: {
  productId: string;
  courseTitle: string;
  existing: { rating: number; comment: string; isPublished: boolean } | null;
}) {
  const [state, action, pending] = useActionState(leaveTestimonial, initial);
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [open, setOpen] = useState(false);

  if (state.ok) {
    return (
      <Card>
        <FormSuccess message={state.message ?? 'Thank you.'} />
      </Card>
    );
  }

  if (existing && !open) {
    return (
      <Card>
        <p className="t-small faint">
          {existing.isPublished
            ? 'Your words are on the course page. Thank you.'
            : 'Thank you — the academy is looking at what you wrote.'}
        </p>
        <blockquote className="t-small mt-2 leading-relaxed">{existing.comment}</blockquote>
        <button
          type="button"
          className="t-small faint mt-2 underline"
          onClick={() => setOpen(true)}
        >
          Change it
        </button>
      </Card>
    );
  }

  return (
    <Card>
      <form action={action} className="space-y-4">
        <input type="hidden" name="productId" value={productId} />
        <input type="hidden" name="rating" value={rating} />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="t-heading">You finished {courseTitle}</h2>
            <p className="t-small muted">
              Would you tell the next person what it was like? Nothing goes up without the academy
              reading it first.
            </p>
          </div>

          <div className="flex items-center gap-1" role="radiogroup" aria-label="Rating out of five">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                role="radio"
                aria-checked={rating === star}
                aria-label={`${star} out of 5`}
                onClick={() => setRating(star)}
                className={`text-2xl leading-none transition ${
                  star <= rating ? 'text-[var(--warn)]' : 'text-[var(--ink-3)] hover:text-[var(--warn)]'
                }`}
              >
                ★
              </button>
            ))}
          </div>
        </div>

        {rating > 0 && (
          <>
            <Textarea
              name="comment"
              rows={3}
              required
              minLength={10}
              maxLength={1200}
              defaultValue={existing?.comment ?? ''}
              placeholder="What worked, and who it would suit."
            />
            <FormError message={state.error} />
            <Button type="submit" disabled={pending}>
              {pending ? 'Sending…' : 'Send'}
            </Button>
          </>
        )}
      </form>
    </Card>
  );
}
