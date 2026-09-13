'use client';

import { useActionState, useState } from 'react';
import { leaveTestimonial } from '@/server/marketing';
import type { ActionState } from '@/server/courses';
import { Button, Card, FormError, FormSuccess, Textarea } from '@/components/ui';
import { REVIEW_MAX_CHARS, REVIEW_MIN_CHARS, inviteCopy } from '@/lib/reviews';

const initial: ActionState = {};

/**
 * Asked only of someone far enough in.
 *
 * A review from a learner two lessons in tells nobody anything, and asking for
 * one is how a course page fills up with three-star noise. The academy sets
 * the line (finished, by default) and decides whether reviews go up at once
 * or wait to be read.
 */
export function TestimonialForm({
  productId,
  courseTitle,
  progressPercent,
  existing,
}: {
  productId: string;
  courseTitle: string;
  progressPercent: number;
  existing: { rating: number; comment: string; isPublished: boolean; reply: string | null } | null;
}) {
  const invite = inviteCopy(progressPercent, courseTitle);
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
        {existing.reply && (
          <div className="mt-3 rounded-[var(--radius-sm)] border-l-4 bg-[var(--surface-2)] p-3" style={{ borderColor: 'var(--brand)' }}>
            <p className="t-micro faint">The academy replied</p>
            <p className="t-small mt-1 leading-relaxed">{existing.reply}</p>
          </div>
        )}
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
            <h2 className="t-heading">{invite.title}</h2>
            <p className="t-small muted">{invite.body}</p>
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
              minLength={REVIEW_MIN_CHARS}
              maxLength={REVIEW_MAX_CHARS}
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
