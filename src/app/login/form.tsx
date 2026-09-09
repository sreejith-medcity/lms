'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { login, type LoginState } from '@/server/session';
import { Button, Field, FormError, Input } from '@/components/ui';

const initial: LoginState = {};

/** What came back from a single sign-on attempt, in words rather than a code. */
const SSO_PROBLEMS: Record<string, string> = {
  cancelled: 'That sign-in was cancelled, so nothing happened.',
  expired: 'That took too long. Try again.',
  failed: 'That sign-in did not complete. Try again, or use your password.',
  unconfigured: 'This academy has not set that up yet. Use your password for now.',
  unverified:
    'That account has an unconfirmed email address, so it cannot be used to sign in here.',
  nomatch:
    'No account here uses that address. Ask your academy to add you, or sign in with the details they gave you.',
  inactive: 'This account is not active. Contact your academy.',
};

export function LoginForm({ sso, problem }: { sso: string[]; problem?: string }) {
  const [state, action, pending] = useActionState(login, initial);

  return (
    <>
      <form action={action} className="mt-7 space-y-4">
        <FormError message={state.error ?? (problem ? SSO_PROBLEMS[problem] : undefined)} />

        <Field label="Email or mobile">
          <Input name="identifier" autoComplete="username" required autoFocus />
        </Field>

        <Field label="Password">
          <Input name="password" type="password" autoComplete="current-password" required />
        </Field>

        <Button type="submit" disabled={pending} size="lg" className="w-full">
          {pending ? 'Signing in...' : 'Sign in'}
        </Button>
      </form>

      <p className="t-small faint mt-4 text-center">
        <Link href="/login/code" className="underline">
          Send me a code instead
        </Link>
        {' · '}
        <Link href="/forgot" className="underline">
          Forgotten your password?
        </Link>
      </p>

      {sso.length > 0 && (
        <>
          <div className="mt-6 flex items-center gap-3">
            <span className="h-px flex-1 bg-[var(--line)]" />
            <span className="t-micro faint">or</span>
            <span className="h-px flex-1 bg-[var(--line)]" />
          </div>

          <div className="mt-4 space-y-2">
            {sso.includes('google') && (
              <a
                href="/api/auth/google/start"
                className="block w-full rounded-[var(--radius-sm)] border px-4 py-2.5 text-center text-sm font-medium transition hover:bg-[var(--surface-2)]"
              >
                Continue with Google
              </a>
            )}
            {sso.includes('microsoft') && (
              <a
                href="/api/auth/microsoft/start"
                className="block w-full rounded-[var(--radius-sm)] border px-4 py-2.5 text-center text-sm font-medium transition hover:bg-[var(--surface-2)]"
              >
                Continue with Microsoft
              </a>
            )}
          </div>

          <p className="t-micro faint mt-3 text-center">
            These sign you into an account your academy has already created. They do not make one.
          </p>
        </>
      )}
    </>
  );
}
