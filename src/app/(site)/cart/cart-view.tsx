'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { formatMoney } from '@/lib/money';
import { CART_EVENT } from '@/lib/cart-cookie';
import { Field, Input } from '@/components/ui';
import { emptyCart, quoteCart, removeItemFromCart, type CartQuote } from '@/server/basket';
import { startCartCheckout } from '@/server/checkout';

/**
 * The cart, and the whole of checkout for somebody without an account.
 *
 * The account question is answered last rather than first, which is the point
 * of the page. A student who has chosen two courses and has a card in their
 * hand is asked for a name, an email and a mobile number, and gets a password
 * afterwards. Making them register first is where a storefront loses the sale
 * it had already made.
 */
export function CartView({
  quote: initial,
  supportEmail,
}: {
  quote: CartQuote;
  supportEmail: string | null;
}) {
  const router = useRouter();
  const [quote, setQuote] = useState(initial);
  const [code, setCode] = useState('');
  const [applied, setApplied] = useState<string>();
  const [usePoints, setUsePoints] = useState(false);
  const [contact, setContact] = useState({ name: '', email: '', phone: '' });
  const [error, setError] = useState<string>();
  const [signInWanted, setSignInWanted] = useState(false);
  const [working, start] = useTransition();

  useEffect(() => setQuote(initial), [initial]);

  const announce = (count: number) =>
    window.dispatchEvent(new CustomEvent(CART_EVENT, { detail: { count } }));

  const requote = (over: { promoCode?: string; usePoints?: boolean } = {}) =>
    start(async () => {
      const next = await quoteCart({
        promoCode: over.promoCode ?? applied,
        usePoints: over.usePoints ?? usePoints,
      });
      setQuote(next);
      announce(next.count);
      if (next.promoError) setApplied(undefined);
    });

  const money = (paise: number) => formatMoney(paise, quote.currency);

  return (
    <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div>
        <ul className="space-y-3">
          {quote.lines.map((line) => (
            <li
              key={line.itemId}
              className="flex gap-4 rounded-[var(--radius-lg)] border bg-[var(--surface)] p-4"
            >
              {line.thumbnailAssetId ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/assets/${line.thumbnailAssetId}`}
                  alt=""
                  className="hidden h-16 w-28 shrink-0 rounded-[var(--radius-sm)] object-cover sm:block"
                />
              ) : null}

              <div className="min-w-0 flex-1">
                <h2 className="t-heading">
                  <Link href={`/course/${line.slug}`} className="hover:text-[var(--brand)]">
                    {line.title}
                  </Link>
                </h2>
                {line.isAddon && <p className="t-small faint mt-0.5">Added alongside your course</p>}
                <button
                  type="button"
                  className="t-small faint mt-2 block underline"
                  disabled={working}
                  onClick={() =>
                    start(async () => {
                      const result = await removeItemFromCart(line.itemId);
                      announce(result.count);
                      const next = await quoteCart({ promoCode: applied, usePoints });
                      setQuote(next);
                      router.refresh();
                    })
                  }
                >
                  Remove
                </button>
              </div>

              <p className="t-heading shrink-0 tabular-nums">{money(line.pricePaise)}</p>
            </li>
          ))}
        </ul>

        {quote.needsOwnCheckout.length > 0 && (
          <div className="mt-4 rounded-[var(--radius)] border border-dashed p-4">
            <p className="t-small font-medium">Paid for separately</p>
            {quote.needsOwnCheckout.map((item) => (
              <p key={item.itemId} className="t-small muted mt-1">
                <Link href={`/course/${item.productId}`} className="underline">
                  {item.title}
                </Link>{' '}
                {item.message}
              </p>
            ))}
          </div>
        )}

        {quote.dropped.length > 0 && (
          <div className="mt-4 rounded-[var(--radius)] border p-4">
            <p className="t-small font-medium">Taken out of your cart</p>
            {quote.dropped.map((d) => (
              <p key={d.itemId} className="t-small muted mt-1">
                {d.title}: {d.message}
              </p>
            ))}
          </div>
        )}

        {quote.lines.length > 0 && (
          <button
            type="button"
            className="t-small faint mt-6 underline"
            disabled={working}
            onClick={() =>
              start(async () => {
                const result = await emptyCart();
                announce(result.count);
                setQuote(await quoteCart());
                router.refresh();
              })
            }
          >
            Empty the cart
          </button>
        )}
      </div>

      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div className="rounded-[var(--radius-lg)] border bg-[var(--surface)] p-5 shadow-sm">
          <h2 className="t-title">Order summary</h2>

          <dl className="mt-4 space-y-2">
            <Row label="Subtotal" value={money(quote.subtotalPaise)} />
            {quote.discountPaise > 0 && (
              <Row
                label={`Discount${quote.promo ? ` (${quote.promo.code})` : ''}`}
                value={`- ${money(quote.discountPaise)}`}
              />
            )}
            {quote.taxPaise > 0 && (
              <Row
                label={quote.taxIncluded ? 'GST (included)' : 'GST'}
                value={money(quote.taxPaise)}
              />
            )}
            {quote.pointsApplied > 0 && (
              <Row label="Your credit" value={`- ${money(quote.pointsWorthPaise)}`} />
            )}
          </dl>

          <div className="mt-4 flex items-baseline justify-between border-t pt-4">
            <span className="t-heading">Total</span>
            <span className="t-price">{money(quote.totalPaise)}</span>
          </div>

          {/* Promo code */}
          <form
            className="mt-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setApplied(code.trim().toUpperCase());
              requote({ promoCode: code.trim() });
            }}
          >
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Promo code"
              aria-label="Promo code"
              maxLength={32}
              className="font-mono uppercase"
            />
            <button
              type="submit"
              disabled={working || !code.trim()}
              className="shrink-0 rounded-[var(--radius-sm)] border bg-[var(--surface)] px-3 text-sm font-medium"
            >
              Apply
            </button>
          </form>
          {quote.promoError && <p className="t-small mt-2 text-[var(--bad)]">{quote.promoError}</p>}

          {quote.signedIn && quote.pointsWorthPaise > 0 && (
            <label className="t-small mt-3 flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-[var(--line-strong)] accent-[var(--brand)]"
                checked={usePoints}
                onChange={(e) => {
                  setUsePoints(e.target.checked);
                  requote({ usePoints: e.target.checked });
                }}
              />
              Use my credit ({money(quote.pointsWorthPaise)} off)
            </label>
          )}

          {/* Who is buying */}
          {!quote.signedIn && (
            <div className="mt-5 space-y-3 border-t pt-5">
              <p className="t-small font-medium">Where should we send your access?</p>
              <Field label="Full name">
                <Input
                  value={contact.name}
                  onChange={(e) => setContact({ ...contact, name: e.target.value })}
                  autoComplete="name"
                  required
                />
              </Field>
              <Field label="Email">
                <Input
                  type="email"
                  value={contact.email}
                  onChange={(e) => setContact({ ...contact, email: e.target.value })}
                  autoComplete="email"
                  required
                />
              </Field>
              <Field label="Mobile number" hint="So the academy can reach you about classes.">
                <Input
                  type="tel"
                  value={contact.phone}
                  onChange={(e) => setContact({ ...contact, phone: e.target.value })}
                  autoComplete="tel"
                  inputMode="numeric"
                  required
                />
              </Field>
              <p className="t-small faint">
                No account needed now. You will set a password straight after paying.
              </p>
            </div>
          )}

          <button
            type="button"
            disabled={working || quote.lines.length === 0}
            className="mt-5 inline-flex h-12 w-full items-center justify-center rounded-[var(--radius-sm)]
              text-sm font-semibold text-[var(--brand-ink)] transition hover:brightness-110
              disabled:opacity-60"
            style={{ background: 'var(--brand)' }}
            onClick={() =>
              start(async () => {
                setError(undefined);
                setSignInWanted(false);

                const started = await startCartCheckout({
                  promoCode: applied,
                  usePoints,
                  contact: quote.signedIn ? undefined : contact,
                });

                if (started.ok) {
                  router.push(`/checkout/${started.orderId}`);
                  return;
                }
                setError(started.error);
                if (started.signIn) setSignInWanted(true);
              })
            }
          >
            {working ? 'Working...' : `Pay ${money(quote.totalPaise)}`}
          </button>

          {error && <p className="t-small mt-3 text-[var(--bad)]">{error}</p>}
          {signInWanted && (
            <Link
              href="/login?next=%2Fcart"
              className="t-small mt-2 inline-block font-semibold underline"
              style={{ color: 'var(--brand)' }}
            >
              Sign in and come back to this cart
            </Link>
          )}

          <p className="t-small faint mt-4">
            Payment is taken by Razorpay. Card details never touch this site.
            {supportEmail ? ` Trouble paying? Write to ${supportEmail}.` : ''}
          </p>
        </div>
      </aside>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="t-small muted">{label}</dt>
      <dd className="t-small tabular-nums">{value}</dd>
    </div>
  );
}
