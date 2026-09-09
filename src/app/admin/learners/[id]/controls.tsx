'use client';

import { useState, useTransition } from 'react';
import { resetPasswordForUser } from '@/server/password-reset';
import { Button, Card } from '@/components/ui';

/**
 * What an academy already does over the phone, made safe: a one-time password
 * shown once, every existing session ended, and a line in the audit trail saying
 * who did it.
 */
export function ResetPassword({ userId, name }: { userId: string; name: string }) {
  const [pending, start] = useTransition();
  const [asking, setAsking] = useState(false);
  const [result, setResult] = useState<{ password?: string; message?: string; error?: string }>();
  const [copied, setCopied] = useState(false);

  if (result?.password) {
    return (
      <Card className="max-w-sm">
        <p className="t-micro faint uppercase tracking-wide">One-time password</p>
        <code className="mt-2 block break-all font-mono text-base">{result.password}</code>
        <button
          type="button"
          className="t-small mt-2 underline"
          onClick={() => {
            navigator.clipboard?.writeText(result.password ?? '');
            setCopied(true);
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
        <p className="t-small muted mt-3">{result.message}</p>
      </Card>
    );
  }

  if (!asking) {
    return (
      <Button variant="secondary" onClick={() => setAsking(true)}>
        Reset password
      </Button>
    );
  }

  return (
    <Card className="max-w-sm">
      <p className="text-sm font-medium">Reset {name}&rsquo;s password?</p>
      <p className="t-small muted mt-1">
        They will be signed out everywhere and given a one-time password you read out. It is shown
        once.
      </p>
      {result?.error && <p className="t-small mt-2 text-[var(--bad)]">{result.error}</p>}
      <div className="mt-3 flex gap-2">
        <Button
          variant="danger"
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await resetPasswordForUser(userId);
              setResult({
                password: res.temporaryPassword,
                message: res.message,
                error: res.error,
              });
            })
          }
        >
          {pending ? 'Resetting...' : 'Reset it'}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setAsking(false)}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}
