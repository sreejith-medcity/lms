import Link from 'next/link';
import { Card } from '@/components/ui';

/**
 * The link to this child has been revoked, or never existed on this
 * contact. Said plainly, with the way back, rather than a bare not-found:
 * a parent who was reading yesterday and is shut out today deserves to be
 * told that the office made a change and whom to ask.
 */
export function AccessRemoved() {
  return (
    <div className="mx-auto max-w-4xl px-5 py-7">
      <Card>
        <h1 className="text-lg font-semibold">This child is no longer on your account</h1>
        <p className="t-small muted mt-2 max-w-prose">
          The academy links a parent's number or email to a learner, and can take that link away, for instance when a contact changes. If you believe this is a mistake, speak to the branch office; they can link you again in a minute.
        </p>
        <Link href="/parent" className="mt-4 inline-flex h-10 items-center rounded-[var(--radius-sm)] border px-4 text-sm hover:bg-[var(--surface-2)]">
          Back to your children
        </Link>
      </Card>
    </div>
  );
}
