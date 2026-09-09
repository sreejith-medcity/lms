'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  saveTestimonial,
  setTestimonialPublished,
  deleteTestimonial,
} from '@/server/marketing';
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
    courseTitle: string | null;
    when: string;
  };
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();

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
            {testimonial.fromLearner ? ' · left by the learner' : ' · added by the team'}
          </p>
        </div>
        <Stars rating={testimonial.rating} />
      </div>

      <blockquote className="t-small mt-3 leading-relaxed">{testimonial.comment}</blockquote>

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
