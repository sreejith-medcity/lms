import Link from 'next/link';
import type { Metadata } from 'next';
import { getSiteContext } from '@/lib/site';
import { NoTenantNotice } from '@/components/tenant-notices';
import { quoteCart } from '@/server/basket';
import { CartView } from './cart-view';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your cart',
  robots: { index: false, follow: true },
};

/**
 * The cart.
 *
 * Everything on this page is priced on the server and read again at checkout,
 * so what is shown here and what Razorpay is asked for come from one function.
 * The page itself is never cached: it is the one public page that is different
 * for every visitor by definition.
 */
export default async function CartPage() {
  const site = await getSiteContext();
  if (!site) return <NoTenantNotice />;

  const quote = await quoteCart();

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <p className="t-eyebrow" style={{ color: 'var(--brand)' }}>
        Checkout
      </p>
      <h1 className="t-display mt-1.5">Your cart</h1>

      {quote.lines.length === 0 && quote.needsOwnCheckout.length === 0 ? (
        <div className="mt-8 rounded-[var(--radius-lg)] border bg-[var(--surface)] p-8 text-center">
          <p className="t-lead">There is nothing in your cart yet.</p>
          <p className="t-small muted mt-2">
            {quote.dropped.length > 0
              ? quote.dropped.map((d) => `${d.title}: ${d.message}`).join(' ')
              : 'Browse the courses and add the ones you want.'}
          </p>
          <Link
            href="/courses"
            className="mt-6 inline-flex h-11 items-center rounded-[var(--radius-sm)] px-5 text-sm
              font-semibold text-[var(--brand-ink)]"
            style={{ background: 'var(--brand)' }}
          >
            Browse courses
          </Link>
        </div>
      ) : (
        <CartView quote={quote} supportEmail={site.organization.supportEmail ?? null} />
      )}
    </div>
  );
}
