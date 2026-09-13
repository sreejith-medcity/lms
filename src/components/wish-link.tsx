'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { WISH_EVENT, readWishFromDocument } from '@/lib/wishlist-cookie';

/** The heart in the header, with a count from the cookie. Hidden until something is saved. */
export function WishLink() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const read = () => setCount(readWishFromDocument(document.cookie).length);
    read();
    window.addEventListener(WISH_EVENT, read);
    window.addEventListener('focus', read);
    return () => {
      window.removeEventListener(WISH_EVENT, read);
      window.removeEventListener('focus', read);
    };
  }, []);
  if (count === 0) return null;
  return (
    <Link
      href="/learn/wishlist"
      aria-label={`Saved for later, ${count} course${count === 1 ? '' : 's'}`}
      className="relative inline-flex h-10 w-10 items-center justify-center rounded-[var(--radius-sm)] transition hover:bg-[var(--surface-2)]"
    >
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden>
        <path d="M12 20.5s-7.5-4.6-9.3-9.4C1.5 7.8 3.6 4.5 7 4.5c2 0 3.4 1 5 2.8 1.6-1.8 3-2.8 5-2.8 3.4 0 5.5 3.3 4.3 6.6C19.5 15.9 12 20.5 12 20.5z" />
      </svg>
      <span
        className="absolute -right-1.5 -top-1.5 min-w-[1.15rem] rounded-full px-1 text-center text-[0.6875rem] font-bold leading-[1.15rem] text-[var(--brand-ink)]"
        style={{ background: 'var(--brand)' }}
      >
        {count > 9 ? '9+' : count}
      </span>
    </Link>
  );
}
