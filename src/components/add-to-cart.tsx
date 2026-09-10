'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { addItemToCart } from '@/server/basket';
import { CART_EVENT } from '@/lib/cart-cookie';

/**
 * Add to cart, wherever a course is shown.
 *
 * It sends a product id and nothing else. Every figure, and whether this
 * course may be sold at all, is decided on the server, so the button cannot be
 * used to invent a price.
 *
 * Once something is in, the button becomes the way to the cart rather than a
 * second copy of itself. A shopper who presses "add" twice and sees the same
 * button both times does not know whether either press worked.
 */
export function AddToCart({
  productId,
  pricingPlanId,
  fullWidth = false,
  label = 'Add to cart',
}: {
  productId: string;
  pricingPlanId?: string;
  fullWidth?: boolean;
  label?: string;
}) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<'idle' | 'in' | 'error'>('idle');
  const [message, setMessage] = useState<string>();

  const width = fullWidth ? 'w-full justify-center' : '';

  if (state === 'in') {
    return (
      <div className={fullWidth ? 'w-full' : ''}>
        <Link
          href="/cart"
          className={`inline-flex h-11 items-center gap-2 rounded-[var(--radius-sm)] border-2 px-5
            text-sm font-semibold transition hover:bg-[var(--surface-2)] ${width}`}
          style={{ borderColor: 'var(--brand)', color: 'var(--brand)' }}
        >
          {message ?? 'In your cart'} · View cart
        </Link>
      </div>
    );
  }

  return (
    <div className={fullWidth ? 'w-full' : ''}>
      <button
        type="button"
        disabled={pending}
        className={`inline-flex h-11 items-center justify-center rounded-[var(--radius-sm)] border-2
          bg-[var(--surface)] px-5 text-sm font-semibold transition hover:bg-[var(--surface-2)]
          disabled:opacity-60 ${width}`}
        style={{ borderColor: 'var(--brand)', color: 'var(--brand)' }}
        onClick={() =>
          start(async () => {
            const result = await addItemToCart(productId, pricingPlanId);

            if (result.ok) {
              setState('in');
              setMessage(result.outcome === 'already-in' ? 'Already in your cart' : 'Added');
            } else {
              setState('error');
              setMessage(result.message);
            }

            window.dispatchEvent(new CustomEvent(CART_EVENT, { detail: { count: result.count } }));
          })
        }
      >
        {pending ? 'Adding...' : label}
      </button>
      {state === 'error' && message && (
        <p className="t-small mt-2 text-[var(--bad)]">{message}</p>
      )}
    </div>
  );
}
