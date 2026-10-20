'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { giveUpEventPlace, registerForEvent } from '@/server/event-registration';
import { Button, FormError, FormSuccess } from '@/components/ui';

/** Register, or give up a free place. Everything it decides is decided again on the server. */
export function RegisterPanel({
  productId,
  signedIn,
  registered,
  canCancel,
  closedReason,
  label,
}: {
  productId: string;
  signedIn: boolean;
  registered: boolean;
  canCancel: boolean;
  closedReason: string | null;
  label: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();

  if (registered) {
    return (
      <div className="space-y-2">
        <FormSuccess message={done ?? 'You have a place.'} />
        {canCancel && (
          <Button
            variant="secondary"
            className="w-full justify-center"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(undefined);
                const res = await giveUpEventPlace(productId);
                if (!res.ok) setError(res.error);
                else {
                  setDone(undefined);
                  router.refresh();
                }
              })
            }
          >
            I can no longer come
          </Button>
        )}
        <FormError message={error} />
      </div>
    );
  }

  if (closedReason) return <p className="t-small muted">{closedReason}</p>;

  return (
    <div className="space-y-2">
      <Button
        size="lg"
        className="liquid w-full justify-center"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(undefined);
            if (!signedIn) {
              router.push(`/signup?next=${encodeURIComponent(window.location.pathname)}`);
              return;
            }
            const res = await registerForEvent(productId);
            if (!res.ok) {
              if (res.signIn) router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`);
              else setError(res.error);
              return;
            }
            if (res.checkoutUrl) {
              router.push(res.checkoutUrl);
              return;
            }
            setDone(res.message);
            router.refresh();
          })
        }
      >
        {pending ? 'One moment' : label}
      </Button>
      <FormError message={error} />
    </div>
  );
}
