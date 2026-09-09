'use client';

import { useActionState, useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveMembership } from '@/server/products';
import type { ActionState } from '@/server/courses';
import { Button, Field, FormError, FormSuccess, Input, Select, Textarea } from '@/components/ui';

const initial: ActionState = {};

export function MembershipForm({
  courses,
  membership,
}: {
  courses: { id: string; title: string }[];
  membership?: {
    id: string;
    title: string;
    description: string;
    billingPeriod: string;
    status: string;
    courseIds: string[];
  };
}) {
  const [state, action, pending] = useActionState(saveMembership, initial);
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set(membership?.courseIds ?? []));

  if (state.ok) setTimeout(() => router.refresh(), 0);

  return (
    <form action={action} className="space-y-4">
      {membership && <input type="hidden" name="id" value={membership.id} />}
      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />

      <Field label="Name">
        <Input
          name="title"
          defaultValue={membership?.title}
          required
          maxLength={160}
          placeholder="Nursing pathway"
        />
      </Field>

      <Field label="Description">
        <Textarea name="description" defaultValue={membership?.description} rows={2} maxLength={1000} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Billed">
          <Select name="billingPeriod" defaultValue={membership?.billingPeriod ?? 'MONTHLY'}>
            <option value="MONTHLY">Monthly</option>
            <option value="QUARTERLY">Quarterly</option>
            <option value="YEARLY">Yearly</option>
          </Select>
        </Field>
        <Field label="Status">
          <Select name="status" defaultValue={membership?.status ?? 'DRAFT'}>
            <option value="DRAFT">Draft</option>
            <option value="PUBLISHED">Published</option>
          </Select>
        </Field>
      </div>

      {!membership && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Price (₹)">
            <Input name="priceRupees" type="number" min={0} step="0.01" defaultValue={0} />
          </Field>
          <Field label="Access for" hint="Days">
            <Input name="validityDays" type="number" min={1} max={3650} defaultValue={30} />
          </Field>
        </div>
      )}

      <div>
        <span className="t-small block font-medium">Unlocks</span>
        <span className="t-small faint mt-0.5 block">
          At least one. A membership that unlocks nothing is a payment for nothing.
        </span>
        <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
          {courses.length === 0 && <li className="t-small faint">No courses yet.</li>}
          {courses.map((c) => (
            <li key={c.id}>
              <label className="flex cursor-pointer items-center gap-2.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-sm hover:bg-[var(--surface-2)]">
                <input
                  type="checkbox"
                  name="courseId"
                  value={c.id}
                  checked={picked.has(c.id)}
                  onChange={() =>
                    setPicked((prev) => {
                      const next = new Set(prev);
                      if (next.has(c.id)) next.delete(c.id);
                      else next.add(c.id);
                      return next;
                    })
                  }
                  className="h-4 w-4 shrink-0 accent-[var(--brand)]"
                />
                <span className="truncate">{c.title}</span>
              </label>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex gap-3">
        <Button type="submit" disabled={pending || picked.size === 0}>
          {pending ? 'Saving...' : membership ? 'Save membership' : 'Create membership'}
        </Button>
        {membership && (
          <a href="/admin/memberships" className="t-small faint self-center underline">
            New instead
          </a>
        )}
      </div>
    </form>
  );
}
