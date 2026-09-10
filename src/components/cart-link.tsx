'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CART_EVENT, readCartCountFromDocument } from '@/lib/cart-cookie';

/**
 * The basket in the header.
 *
 * Read in the browser from a cookie, like the account link beside it, because
 * a number rendered on the server would make every public page different per
 * visitor and stop a CDN holding any of them.
 *
 * It also listens for the event the add-to-cart button fires, so pressing
 * "add" anywhere on a page moves the badge without a round trip.
 */
export function CartLink() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    const read = () => setCount(readCartCountFromDocument(document.cookie));
    read();

    const onCart = (event: Event) => {
      const detail = (event as CustomEvent<{ count?: number }>).detail;
      if (typeof detail?.count === 'number') setCount(detail.count);
      else read();
    };

    window.addEventListener(CART_EVENT, onCart);
    // Coming back to a tab that was open while the cart changed elsewhere.
    window.addEventListener('focus', read);
    return () => {
      window.removeEventListener(CART_EVENT, onCart);
      window.removeEventListener('focus', read);
    };
  }, []);

  return (
    <Link
      href="/cart"
      aria-label={count ? `Cart, ${count} item${count === 1 ? '' : 's'}` : 'Cart'}
      className="relative inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)]
        border bg-[var(--surface)] transition hover:bg-[var(--surface-2)]"
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
        <path
          d="M3 4h2l2.4 10.4a2 2 0 0 0 2 1.6h6.9a2 2 0 0 0 2-1.5L20 8H6"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="10" cy="20" r="1.4" fill="currentColor" />
        <circle cx="17" cy="20" r="1.4" fill="currentColor" />
      </svg>
      {count ? (
        <span
          className="absolute -right-1.5 -top-1.5 min-w-[1.15rem] rounded-full px-1 text-center
            text-[0.6875rem] font-bold leading-[1.15rem] text-[var(--brand-ink)]"
          style={{ background: 'var(--brand)' }}
        >
          {count > 9 ? '9+' : count}
        </span>
      ) : null}
    </Link>
  );
}
