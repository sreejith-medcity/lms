'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createPost, createComment, flagPost } from '@/server/community';
import type { ActionState } from '@/server/courses';
import { Button, Card, FormError, Input, Textarea } from '@/components/ui';

const initial: ActionState = {};

export function PostBox({ communityId }: { communityId: string }) {
  const [state, action, pending] = useActionState(createPost, initial);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Card>
        <button
          type="button"
          className="t-small faint w-full text-left"
          onClick={() => setOpen(true)}
        >
          Ask something, or share what worked…
        </button>
      </Card>
    );
  }

  return (
    <Card>
      <form action={action} className="space-y-3">
        <input type="hidden" name="communityId" value={communityId} />
        <Input name="title" maxLength={160} placeholder="A short title (optional)" />
        <Textarea name="body" rows={4} required maxLength={8000} autoFocus placeholder="What is on your mind?" />
        <FormError message={state.error} />
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? 'Posting…' : 'Post'}
          </Button>
          <button type="button" className="t-small faint hover:underline" onClick={() => setOpen(false)}>
            Cancel
          </button>
        </div>
      </form>
    </Card>
  );
}

export function ReplyBox({ postId }: { postId: string }) {
  const [state, action, pending] = useActionState(createComment, initial);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button type="button" className="t-small faint hover:underline" onClick={() => setOpen(true)}>
        Reply
      </button>
    );
  }

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="postId" value={postId} />
      <Textarea name="body" rows={2} required maxLength={4000} autoFocus placeholder="Your reply" />
      <FormError message={state.error} />
      <div className="flex items-center gap-3">
        <Button size="sm" type="submit" disabled={pending}>
          {pending ? 'Sending…' : 'Reply'}
        </Button>
        <button type="button" className="t-small faint hover:underline" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * Reporting, and nothing else.
 *
 * A learner can say "somebody should look at this" and that is the whole of
 * their power here: the post stays up until a moderator decides otherwise.
 */
export function PostMenu({ postId, alreadyFlagged }: { postId: string; alreadyFlagged: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [done, setDone] = useState(alreadyFlagged);
  const [error, setError] = useState<string>();

  if (done) return <span className="t-micro faint">reported</span>;

  return (
    <>
      <button
        type="button"
        className="t-micro faint hover:text-[var(--bad)]"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await flagPost(postId);
            setError(res.error);
            if (!res.error) {
              setDone(true);
              router.refresh();
            }
          })
        }
      >
        Report
      </button>
      {error && <span className="t-micro text-[var(--bad)]">{error}</span>}
    </>
  );
}
