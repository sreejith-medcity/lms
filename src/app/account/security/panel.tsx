'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  beginTwoFactor,
  confirmTwoFactor,
  disableTwoFactor,
  regenerateRecoveryCodes,
  type SetupState,
} from '@/server/two-factor';
import type { ActionState } from '@/server/courses';
import { Badge, Button, Card, Field, FormError, FormSuccess, Input } from '@/components/ui';

const initial: SetupState = {};
const initialAction: ActionState = {};

/** Grouped in fours, because a 32 character string typed by eye is a typo. */
function grouped(secret: string): string {
  return secret.match(/.{1,4}/g)?.join(' ') ?? secret;
}

export function SecurityPanel({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [setup, setSetup] = useState<SetupState>({});
  const [confirmed, confirmAction, confirming] = useActionState(confirmTwoFactor, initial);
  const [offState, offAction, turningOff] = useActionState(disableTwoFactor, initialAction);
  const [busy, start] = useTransition();

  const codes = confirmed.recoveryCodes ?? setup.recoveryCodes;

  if (enabled) {
    return (
      <div className="space-y-4">
        <Card>
          <p className="flex items-center gap-2 font-medium">
            Two factor <Badge tone="ok">on</Badge>
          </p>
          <p className="t-small muted mt-1">
            Signing in on a new device asks for a code from your authenticator app.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                start(async () => {
                  setSetup(await regenerateRecoveryCodes());
                  router.refresh();
                })
              }
            >
              {busy ? 'Working...' : 'New recovery codes'}
            </Button>
          </div>

          {codes && <RecoveryCodes codes={codes} />}
          <FormSuccess message={setup.ok ? setup.message : undefined} />
          <FormError message={setup.error} />
        </Card>

        <Card>
          <p className="font-medium">Turn it off</p>
          <p className="t-small muted mt-1">
            Your password is needed, so that an unlocked laptop is not enough to remove it.
          </p>

          <form action={offAction} className="mt-3 space-y-3">
            <Field label="Your password">
              <Input name="password" type="password" autoComplete="current-password" required />
            </Field>
            <FormError message={offState.error} />
            <FormSuccess message={offState.ok ? offState.message : undefined} />
            <Button type="submit" variant="secondary" disabled={turningOff}>
              {turningOff ? 'Working...' : 'Turn off two factor'}
            </Button>
          </form>
        </Card>
      </div>
    );
  }

  return (
    <Card>
      <p className="flex items-center gap-2 font-medium">
        Two factor <Badge tone="neutral">off</Badge>
      </p>
      <p className="t-small muted mt-1">
        A code from an app on your phone, on top of your password. Worth turning on for any account
        that can see learner records or move money.
      </p>

      {!setup.secret && (
        <div className="mt-3">
          <Button
            disabled={busy}
            onClick={() =>
              start(async () => {
                setSetup(await beginTwoFactor());
              })
            }
          >
            {busy ? 'Working...' : 'Set it up'}
          </Button>
          <FormError message={setup.error} />
        </div>
      )}

      {setup.secret && !confirmed.ok && (
        <div className="mt-4 space-y-3 border-t pt-4">
          <div>
            <p className="t-small font-medium">1. Add it to your app</p>
            <p className="t-small muted mt-1">
              In Google Authenticator, Authy or your password manager, choose to add an account by
              entering a key, and type this:
            </p>
            <p className="mt-2 select-all rounded-[var(--radius-sm)] bg-[var(--surface-2)] p-3 font-mono text-sm tracking-wider">
              {grouped(setup.secret)}
            </p>
            <p className="t-micro faint mt-1">
              On the phone itself you can open{' '}
              <a href={setup.uri} className="underline">
                this link
              </a>{' '}
              instead and the app will fill it in.
            </p>
          </div>

          <form action={confirmAction} className="space-y-3">
            <p className="t-small font-medium">2. Prove it worked</p>
            <Field
              label="The six digit code your app is showing"
              hint="Nothing changes until this matches, so a mistyped key cannot lock you out."
            >
              <Input name="code" inputMode="numeric" maxLength={6} required />
            </Field>
            <FormError message={confirmed.error} />
            <Button type="submit" disabled={confirming}>
              {confirming ? 'Checking...' : 'Turn on two factor'}
            </Button>
          </form>
        </div>
      )}

      {confirmed.ok && (
        <div className="mt-4 border-t pt-4">
          <FormSuccess message={confirmed.message} />
          {codes && <RecoveryCodes codes={codes} />}
        </div>
      )}
    </Card>
  );
}

function RecoveryCodes({ codes }: { codes: string[] }) {
  return (
    <div className="mt-3">
      <p className="t-small font-medium">Recovery codes</p>
      <p className="t-small muted mt-1">
        Each one works once, if you lose the phone. They are shown now and never again, because
        they are stored hashed the same way a password is.
      </p>
      <ul className="mt-2 grid grid-cols-2 gap-1 rounded-[var(--radius-sm)] bg-[var(--surface-2)] p-3 font-mono text-sm">
        {codes.map((code) => (
          <li key={code} className="select-all">
            {code}
          </li>
        ))}
      </ul>
    </div>
  );
}
