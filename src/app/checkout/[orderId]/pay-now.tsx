'use client';

import Script from 'next/script';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { Button } from '@/components/ui';

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

type Stage = 'idle' | 'opening' | 'verifying' | 'pending' | 'done' | 'error';

/**
 * Opens Razorpay's own checkout. Card details are entered inside their iframe and
 * never touch this origin.
 *
 * When the modal closes, the response goes to our verify endpoint, which checks
 * the signature and asks Razorpay's API what really happened before granting
 * anything. If this browser never gets that far, because the tab closed or the
 * network dropped, the webhook completes the same order server-side, so the
 * learner ends up enrolled either way.
 */
export function PayNow({
  orderId,
  gatewayOrderId,
  keyId,
  testMode,
  amountPaise,
  currency,
  organizationName,
  brandColor,
  learnerName,
  learnerEmail,
  productId,
}: {
  orderId: string;
  gatewayOrderId: string;
  keyId: string;
  testMode: boolean;
  amountPaise: number;
  currency: string;
  organizationName: string;
  brandColor: string;
  learnerName: string;
  learnerEmail: string | null;
  productId: string | null;
}) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('idle');
  const [message, setMessage] = useState<string>();
  const [ready, setReady] = useState(false);

  const pay = useCallback(() => {
    if (!window.Razorpay) {
      setStage('error');
      setMessage('The payment window could not load. Check your connection and try again.');
      return;
    }

    setStage('opening');
    setMessage(undefined);

    const rzp = new window.Razorpay({
      key: keyId,
      order_id: gatewayOrderId,
      amount: amountPaise,
      currency,
      name: organizationName,
      description: 'Course enrolment',
      theme: { color: brandColor },
      prefill: { name: learnerName, email: learnerEmail ?? undefined },
      retry: { enabled: false },
      modal: {
        ondismiss: () => setStage('idle'),
      },
      handler: async (response: Record<string, string>) => {
        setStage('verifying');
        try {
          const res = await fetch('/api/payments/razorpay/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...response, orderId }),
          });

          if (res.status === 202) {
            setStage('pending');
            setMessage(
              'Your payment is going through. This page updates as soon as the bank confirms it.',
            );
            setTimeout(() => router.refresh(), 4000);
            return;
          }

          const body = (await res.json().catch(() => null)) as
            | { error?: string; reference?: string }
            | null;
          if (!res.ok) {
            setStage('error');
            setMessage(body?.error ?? 'We could not confirm that payment.');
            return;
          }

          setStage('done');
          router.replace(productId ? `/learn/${productId}` : '/learn');
        } catch {
          // The money may well have gone through; the webhook settles it. Say
          // that plainly rather than implying the payment failed.
          setStage('pending');
          setMessage(
            'We lost the connection while confirming. If the payment went through, your access appears within a minute.',
          );
          setTimeout(() => router.refresh(), 5000);
        }
      },
    });

    rzp.open();
  }, [
    amountPaise,
    brandColor,
    currency,
    gatewayOrderId,
    keyId,
    learnerEmail,
    learnerName,
    orderId,
    organizationName,
    productId,
    router,
  ]);

  return (
    <div>
      <Script
        src="https://checkout.razorpay.com/v1/checkout.js"
        onReady={() => setReady(true)}
        onError={() => {
          setStage('error');
          setMessage('The payment window could not load.');
        }}
      />

      <Button
        size="lg"
        className="w-full justify-center"
        disabled={!ready || stage === 'opening' || stage === 'verifying' || stage === 'done'}
        onClick={pay}
      >
        {stage === 'verifying'
          ? 'Confirming payment...'
          : stage === 'done'
            ? 'Enrolled'
            : ready
              ? 'Pay securely'
              : 'Loading payment...'}
      </Button>

      {testMode && (
        <p className="t-small mt-3 rounded-[var(--radius-sm)] border border-dashed p-3 text-[var(--warn)]">
          Test mode. No real money moves. Use Razorpay&rsquo;s test card 4111 1111 1111 1111 with
          any future expiry and any CVV.
        </p>
      )}

      {message && (
        <p
          className={`t-small mt-3 ${stage === 'error' ? 'text-[var(--bad)]' : 'muted'}`}
          role="status"
        >
          {message}
        </p>
      )}
    </div>
  );
}
