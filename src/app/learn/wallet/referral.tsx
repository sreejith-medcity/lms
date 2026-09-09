'use client';

import { useState, useTransition } from 'react';
import { myReferralCode } from '@/server/wallet';
import { Button, Card } from '@/components/ui';

/**
 * The code, made on first ask.
 *
 * Most people never share one, so generating a code for every account at signup
 * would fill a table with strings nobody uses.
 */
export function ReferralPanel({ referred }: { referred: number }) {
  const [pending, start] = useTransition();
  const [code, setCode] = useState<string>();
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);

  return (
    <Card>
      <h2 className="t-heading">Bring someone with you</h2>
      <p className="t-small muted mt-1">
        They get credit for joining with your code, and so do you.
        {referred > 0 ? ` ${referred} ${referred === 1 ? 'person has' : 'people have'} used it.` : ''}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {code ? (
          <>
            <span className="rounded-[var(--radius-sm)] border bg-[var(--surface-2)] px-4 py-2 font-mono text-lg font-semibold tracking-wider">
              {code}
            </span>
            <Button
              variant="secondary"
              onClick={() => {
                navigator.clipboard?.writeText(code).then(
                  () => setCopied(true),
                  () => setCopied(false),
                );
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </>
        ) : (
          <Button
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await myReferralCode();
                if (res.code) setCode(res.code);
                setError(res.error);
              })
            }
          >
            {pending ? 'Making one…' : 'Get my code'}
          </Button>
        )}
      </div>

      {error && <p className="t-small mt-2 text-[var(--bad)]">{error}</p>}
    </Card>
  );
}
