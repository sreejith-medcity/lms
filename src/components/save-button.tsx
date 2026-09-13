'use client';

import { useEffect, useState, useTransition } from 'react';
import { toggleWish } from '@/server/wishlist';
import { WISH_EVENT, readWishFromDocument } from '@/lib/wishlist-cookie';

/**
 * The heart. Decided in the browser from the cookie, so a cached course
 * page still shows the right one; toggled through a server action that
 * writes the cookie and, for a signed-in learner, the database.
 */
export function SaveButton({ productId, compact = false, className = '' }: { productId: string; compact?: boolean; className?: string }) {
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    const read = () => setSaved(readWishFromDocument(document.cookie).includes(productId));
    read();
    window.addEventListener(WISH_EVENT, read);
    return () => window.removeEventListener(WISH_EVENT, read);
  }, [productId]);

  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-label={saved ? 'Saved for later. Remove from your list' : 'Save for later'}
      title={saved ? 'Saved' : 'Save for later'}
      disabled={pending}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        start(async () => {
          const r = await toggleWish(productId);
          if (!r.error) {
            setSaved(r.saved);
            window.dispatchEvent(new Event(WISH_EVENT));
          }
        });
      }}
      className={`inline-flex items-center justify-center gap-1.5 rounded-full border bg-[var(--surface)] ${compact ? 'h-8 w-8' : 'h-10 px-3.5 text-sm font-medium'} ${className}`}
      style={saved ? { borderColor: 'var(--bad)', color: 'var(--bad)' } : undefined}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill={saved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden>
        <path d="M12 20.5s-7.5-4.6-9.3-9.4C1.5 7.8 3.6 4.5 7 4.5c2 0 3.4 1 5 2.8 1.6-1.8 3-2.8 5-2.8 3.4 0 5.5 3.3 4.3 6.6C19.5 15.9 12 20.5 12 20.5z" />
      </svg>
      {!compact && (saved ? 'Saved' : 'Save for later')}
    </button>
  );
}
