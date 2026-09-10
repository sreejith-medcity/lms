'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { readWhoFromDocument, type Who } from '@/lib/who-cookie';

/**
 * The one part of the public header that depends on who is looking.
 *
 * Rendered in the browser rather than on the server, so the HTML around it is
 * the same for everybody and a CDN can hold it. Until the effect runs there is
 * nothing here but a fixed-width space, which keeps the header from jumping.
 */
export function AccountLink() {
  const [who, setWho] = useState<Who | null | undefined>(undefined);

  useEffect(() => {
    setWho(readWhoFromDocument(document.cookie));
  }, []);

  // Undecided. A placeholder of the same size as the widest outcome, so
  // nothing shifts when it resolves.
  if (who === undefined) {
    return <div className="h-9 w-[6.5rem]" aria-hidden="true" />;
  }

  if (who) {
    return (
      <Link
        href={who === 'staff' ? '/admin' : '/learn'}
        className="inline-flex h-9 items-center rounded-[var(--radius-sm)] px-3.5 text-sm font-medium text-[var(--brand-ink)]"
        style={{ background: 'var(--brand)' }}
      >
        {who === 'staff' ? 'Admin' : 'My learning'}
      </Link>
    );
  }

  return (
    <>
      <Link
        href="/login"
        className="hidden h-9 items-center rounded-[var(--radius-sm)] border bg-[var(--surface)] px-3.5 text-sm font-medium sm:inline-flex"
      >
        Sign in
      </Link>
      <Link
        href="/signup"
        className="inline-flex h-9 items-center rounded-[var(--radius-sm)] px-3.5 text-sm font-medium text-[var(--brand-ink)]"
        style={{ background: 'var(--brand)' }}
      >
        Get started
      </Link>
    </>
  );
}
