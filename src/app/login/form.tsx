'use client';

import { useActionState } from 'react';
import { login, type LoginState } from '@/server/session';

const initial: LoginState = {};

export function LoginForm() {
  const [state, action, pending] = useActionState(login, initial);

  return (
    <form action={action} className="mt-6 space-y-4">
      <div>
        <label htmlFor="identifier" className="block text-sm text-slate-600">
          Email or mobile
        </label>
        <input
          id="identifier"
          name="identifier"
          autoComplete="username"
          className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
          required
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-sm text-slate-600">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
          required
        />
      </div>

      {state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg px-3 py-2 text-sm text-white disabled:opacity-60"
        style={{ background: 'var(--brand)' }}
      >
        {pending ? 'Signing in...' : 'Sign in'}
      </button>
    </form>
  );
}
