'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteAnnouncement, postAnnouncement } from '@/server/announcements';
import type { ActionState } from '@/server/courses';
import { Button, Field, FormError, FormSuccess, Input, Select, Textarea } from '@/components/ui';

const initial: ActionState = {};

export function AnnouncementForm({ batches }: { batches: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(postAnnouncement, initial);
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set());

  if (state.ok) setTimeout(() => router.refresh(), 0);

  return (
    <form action={action} className="space-y-4">
      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />

      <Field label="Title">
        <Input name="title" required maxLength={160} placeholder="Saturday class moved to 4pm" />
      </Field>

      <Field label="Announcement">
        <Textarea name="bodyHtml" rows={4} required maxLength={4000} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Urgency">
          <Select name="urgency" defaultValue="NORMAL">
            <option value="NORMAL">Normal</option>
            <option value="HIGH">Urgent</option>
          </Select>
        </Field>
        <Field label="Publish at" hint="Leave blank for now">
          <Input name="publishAt" type="datetime-local" />
        </Field>
      </div>

      <div>
        <span className="t-small block font-medium">Who sees it</span>
        <span className="t-small faint mt-0.5 block">
          Pick nothing and it goes to everyone. An announcement that does not apply to you teaches
          you to ignore the next one.
        </span>

        <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
          {batches.length === 0 && <li className="t-small faint">No active batches.</li>}
          {batches.map((b) => (
            <li key={b.id}>
              <label className="flex cursor-pointer items-center gap-2.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-sm hover:bg-[var(--surface-2)]">
                <input
                  type="checkbox"
                  name="batchId"
                  value={b.id}
                  checked={picked.has(b.id)}
                  onChange={() =>
                    setPicked((prev) => {
                      const next = new Set(prev);
                      if (next.has(b.id)) next.delete(b.id);
                      else next.add(b.id);
                      return next;
                    })
                  }
                  className="h-4 w-4 shrink-0 accent-[var(--brand)]"
                />
                <span className="truncate">{b.name}</span>
              </label>
            </li>
          ))}
        </ul>
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? 'Posting...' : picked.size > 0 ? `Post to ${picked.size}` : 'Post to everyone'}
      </Button>
    </form>
  );
}

export function DeleteAnnouncement({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await deleteAnnouncement(id);
          router.refresh();
        })
      }
    >
      Remove
    </Button>
  );
}
