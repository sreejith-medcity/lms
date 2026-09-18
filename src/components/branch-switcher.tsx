'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { viewAsBranch } from '@/server/branch-view';

/** Head Office picks a branch to look at as its head would; "Whole academy" clears it. */
export function BranchSwitcher({ branches, current }: { branches: { id: string; name: string }[]; current: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (branches.length < 2) return null;
  return (
    <select
      aria-label="Branch to view"
      className="t-small rounded-[var(--radius-sm)] border bg-[var(--surface)] px-2 py-1"
      value={current ?? ''}
      disabled={pending}
      onChange={(e) =>
        start(async () => {
          await viewAsBranch(e.target.value || null);
          router.refresh();
        })
      }
    >
      <option value="">Whole academy</option>
      {branches.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name} only
        </option>
      ))}
    </select>
  );
}
