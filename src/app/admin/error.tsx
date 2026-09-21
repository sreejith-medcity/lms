'use client';

import Link from 'next/link';

/**
 * What a member of staff sees when an admin page cannot be shown: most
 * often a page their role does not open, sometimes a fault. Next strips
 * the server's message in production, so the two are told apart by what
 * the person can do about it, not by the reason: try again, or go back
 * to the desk. Without this, the raw "Application error" page appears,
 * which is the one screen that should never reach a teacher's phone.
 */
export default function AdminError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <p className="t-small faint">This page could not be shown</p>
      <h1 className="t-title mt-2">Either your role does not open it, or something went wrong.</h1>
      <p className="t-small muted mt-3">
        If you expected to see this page, ask your Branch Head to check your role. If it worked a moment ago, try again; nothing was changed.
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <button type="button" onClick={reset} className="inline-flex h-9 items-center rounded-[var(--radius-sm)] border px-3 text-sm hover:bg-[var(--surface-2)]">
          Try again
        </button>
        <Link href="/admin/desk" className="inline-flex h-9 items-center rounded-[var(--radius-sm)] bg-[var(--brand)] px-3 text-sm font-medium text-[var(--brand-ink)]">
          Back to the desk
        </Link>
      </div>
    </div>
  );
}
