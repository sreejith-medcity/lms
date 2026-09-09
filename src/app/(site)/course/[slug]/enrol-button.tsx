'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { enrol } from '@/server/enrollment';
import { startCheckout } from '@/server/checkout';
import { quotePromoCode } from '@/server/promo';
import { formatMoney } from '@/lib/money';
import { Button, Input } from '@/components/ui';

export function EnrolButton({
  productId,
  signedIn,
  isPaid = false,
  pricingPlanId,
  pricePaise = 0,
  currency = 'INR',
  pointsWorthPaise = 0,
  fullWidth = false,
}: {
  productId: string;
  signedIn: boolean;
  isPaid?: boolean;
  pricingPlanId?: string;
  pricePaise?: number;
  currency?: string;
  /** What this learner's points could take off this order, if they choose to. */
  pointsWorthPaise?: number;
  fullWidth?: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [code, setCode] = useState('');
  const [applied, setApplied] = useState<{ code: string; discountPaise: number } | null>(null);
  const [codeError, setCodeError] = useState<string>();
  const [checking, startCheck] = useTransition();
  const [showCode, setShowCode] = useState(false);
  const [usePoints, setUsePoints] = useState(false);
  const router = useRouter();

  return (
    <div className={fullWidth ? '' : 'text-right'}>
      <Button
        variant={isPaid ? 'accent' : 'primary'}
        disabled={pending}
        size="lg"
        className={fullWidth ? 'w-full justify-center' : ''}
        onClick={() =>
          start(async () => {
            if (!signedIn) {
              // Come back to this course after signing in rather than dumping
              // the visitor on a dashboard and making them find it again.
              router.push(`/signup?next=${encodeURIComponent(window.location.pathname)}`);
              return;
            }

            if (isPaid) {
              const started = await startCheckout(
                productId,
                pricingPlanId,
                applied?.code,
                usePoints,
              );
              if (started.ok) router.push(`/checkout/${started.orderId}`);
              else if (started.signIn) router.push('/login');
              else setError(started.error);
              return;
            }

            const res = await enrol(productId);
            if (res?.error === 'SIGN_IN_REQUIRED') router.push('/login');
            else setError(res?.error);
          })
        }
      >
        {pending
          ? isPaid
            ? 'Opening checkout...'
            : 'Enrolling...'
          : signedIn
            ? isPaid
              ? 'Enrol now'
              : 'Enrol free'
            : 'Sign up to enrol'}
      </Button>
      {error && <p className="t-small mt-2 max-w-xs text-[var(--bad)]">{error}</p>}

      {isPaid && signedIn && pointsWorthPaise > 0 && (
        <label className="t-small mt-3 flex items-center justify-end gap-2">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-[var(--line-strong)] accent-[var(--brand)]"
            checked={usePoints}
            onChange={(e) => setUsePoints(e.target.checked)}
          />
          Use my credit ({formatMoney(pointsWorthPaise, currency)} off)
        </label>
      )}

      {isPaid && signedIn && (
        <div className={`mt-3 ${fullWidth ? '' : 'flex flex-col items-end'}`}>
          {applied ? (
            <p className="t-small">
              <span className="font-medium">{applied.code}</span> applied —{' '}
              {formatMoney(applied.discountPaise, currency)} off.{' '}
              <button
                type="button"
                className="faint underline"
                onClick={() => {
                  setApplied(null);
                  setCode('');
                }}
              >
                remove
              </button>
            </p>
          ) : showCode ? (
            <form
              className="flex w-full max-w-xs gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                startCheck(async () => {
                  const quote = await quotePromoCode(code, productId, pricePaise);
                  if (quote.ok && quote.code && quote.discountPaise != null) {
                    setApplied({ code: quote.code, discountPaise: quote.discountPaise });
                    setCodeError(undefined);
                  } else {
                    setCodeError(quote.error);
                  }
                });
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
              <Button type="submit" variant="secondary" disabled={checking || !code.trim()}>
                {checking ? '…' : 'Apply'}
              </Button>
            </form>
          ) : (
            <button
              type="button"
              className="t-small faint underline"
              onClick={() => setShowCode(true)}
            >
              Have a promo code?
            </button>
          )}
          {codeError && <p className="t-small mt-1 max-w-xs text-[var(--bad)]">{codeError}</p>}
        </div>
      )}
    </div>
  );
}
