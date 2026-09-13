'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  saveTestimonial,
  setTestimonialPublished,
  deleteTestimonial,
  replyToTestimonial,
} from '@/server/marketing';
import { REPLY_MAX_CHARS } from '@/lib/reviews';
import type { ActionState } from '@/server/courses';
import {
  Badge,
  Button,
  Card,
  Field,
  FormError,
  FormSuccess,
  Input,
  Select,
  Textarea,
} from '@/components/ui';

const initial: ActionState = {};

function Stars({ rating }: { rating: number }) {
  return (
    <span aria-label={`${rating} out of 5`} className="text-[var(--warn)]">
      {'★'.repeat(Math.round(rating))}
      <span className="text-[var(--ink-3)]">{'★'.repeat(5 - Math.round(rating))}</span>
    </span>
  );
}

export function TestimonialRow({
  testimonial,
  canEdit,
}: {
  testimonial: {
    id: string;
    authorName: string;
    authorEmail: string | null;
    rating: number;
    comment: string;
    isPublished: boolean;
    fromLearner: boolean;
    progressAtReview: number | null;
    reply: string | null;
    courseTitle: string | null;
    when: string;
  };
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [replying, setReplying] = useState(false);
  const [draft, setDraft] = useState(testimonial.reply ?? '');

  function run(work: () => Promise<ActionState>) {
    start(async () => {
      const res = await work();
      setError(res.error);
      if (!res.error) router.refresh();
    });
  }

  return (
    <Card className={testimonial.isPublished ? '' : 'border-[var(--warn)]/40'}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{testimonial.authorName}</p>
          <p className="t-micro faint truncate">
            {testimonial.when}
            {testimonial.courseTitle ? ` · ${testimonial.courseTitle}` : ''}
            {testimonial.fromLearner
              ? testimonial.progressAtReview != null
                ? testimonial.progressAtReview >= 100
                  ? ' · left by the learner, after finishing'
                  : ` · left by the learner, ${testimonial.progressAtReview}% through`
                : ' · left by the learner'
              : ' · added by the team'}
          </p>
        </div>
        <Stars rating={testimonial.rating} />
      </div>

      <blockquote className="t-small mt-3 leading-relaxed">{testimonial.comment}</blockquote>

      {testimonial.reply && !replying && (
        <div className="mt-3 rounded-[var(--radius-sm)] border-l-4 bg-[var(--surface-2)] p-3" style={{ borderColor: 'var(--brand)' }}>
          <p className="t-micro faint">The academy replied</p>
          <p className="t-small mt-1 leading-relaxed">{testimonial.reply}</p>
        </div>
      )}

      {replying && (
        <div className="mt-3 space-y-2">
          <Textarea
            rows={3}
            maxLength={REPLY_MAX_CHARS}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Thank them, or answer the point they made. This is public, under the review."
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={pending} onClick={() => run(async () => { const r = await replyToTestimonial(testimonial.id, draft); if (!r.error) setReplying(false); return r; })}>
              {draft.trim() ? 'Post the reply' : testimonial.reply ? 'Remove the reply' : 'Post the reply'}
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => { setReplying(false); setDraft(testimonial.reply ?? ''); }}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {canEdit ? (
          <>
            <Button
              size="sm"
              variant={testimonial.isPublished ? 'secondary' : 'primary'}
              disabled={pending}
              onClick={() =>
                run(() => setTestimonialPublished(testimonial.id, !testimonial.isPublished))
              }
            >
              {testimonial.isPublished ? 'Take it down' : 'Publish'}
            </Button>
            {!replying && (
              <Button size="sm" variant="secondary" disabled={pending} onClick={() => setReplying(true)}>
                {testimonial.reply ? 'Edit the reply' : 'Reply in public'}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => run(() => deleteTestimonial(testimonial.id))}
            >
              Delete
            </Button>
          </>
        ) : (
          <Badge tone={testimonial.isPublished ? 'ok' : 'warn'}>
            {testimonial.isPublished ? 'on the site' : 'waiting'}
          </Badge>
        )}
        {error && <span className="t-small text-[var(--bad)]">{error}</span>}
      </div>
    </Card>
  );
}

export function NewTestimonial({ products }: { products: { id: string; title: string }[] }) {
  const [state, action, pending] = useActionState(saveTestimonial, initial);

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Their name">
          <Input name="authorName" required maxLength={120} />
        </Field>
        <Field label="Their email" hint="Optional, kept private.">
          <Input name="authorEmail" type="email" maxLength={160} />
        </Field>
        <Field label="Rating">
          <Select name="rating" defaultValue="5">
            {[5, 4, 3, 2, 1].map((r) => (
              <option key={r} value={r}>
                {r} star{r === 1 ? '' : 's'}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Course" hint="Optional.">
          <Select name="productId" defaultValue="">
            <option value="">Not about one course</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="What they said">
        <Textarea name="comment" rows={3} required maxLength={1200} />
      </Field>

      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />

      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Add and publish'}
      </Button>
    </form>
  );
}
