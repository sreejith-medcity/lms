'use client';

import { useActionState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  grantAssessment,
  grantPool,
  withdrawAssessmentGrant,
  withdrawPoolGrant,
} from '@/server/assessment-grants';
import type { ActionState } from '@/server/courses';
import { Button, Card, Field, FormError, FormSuccess, Input, Select } from '@/components/ui';

const initial: ActionState = {};

export interface TestOption {
  id: string;
  title: string;
  maxAttempts: number;
}

export interface PoolOption {
  id: string;
  name: string;
  count: number;
}

export interface GrantRow {
  id: string;
  title: string;
  detail: string;
}

/**
 * What this candidate has beyond their course.
 *
 * The office's version of this conversation is "give her two more goes at
 * the OET mock before Thursday", so the form is one line: the test, the
 * extra attempts, and optionally a date it closes for her. What has already
 * been given is listed underneath with a way to take it back.
 */
export function LearnerTests({
  userId,
  tests,
  pools,
  grants,
  poolGrants,
}: {
  userId: string;
  tests: TestOption[];
  pools: PoolOption[];
  grants: GrantRow[];
  poolGrants: GrantRow[];
}) {
  const [state, action, pending] = useActionState(grantAssessment, initial);
  const [poolState, poolAction, poolPending] = useActionState(grantPool, initial);
  const [working, start] = useTransition();
  const router = useRouter();

  const remove = (fn: (id: string) => Promise<ActionState>, id: string) =>
    start(async () => {
      await fn(id);
      router.refresh();
    });

  return (
    <Card className="space-y-5">
      <div>
        <h2 className="t-heading">Extra tests</h2>
        <p className="t-small muted mt-1">
          Their course tests need nothing here. This is for a test the course does not include, or
          for more attempts at one it does.
        </p>
      </div>

      <form action={action} className="space-y-3">
        <input type="hidden" name="userId" value={userId} />

        <Field label="Test">
          <Select name="assessmentId" required defaultValue="">
            <option value="" disabled>
              Pick a test
            </option>
            {tests.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title} ({t.maxAttempts} attempt{t.maxAttempts === 1 ? '' : 's'} normally)
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Extra attempts" hint="On top of the test's own.">
            <Input name="extraAttempts" type="number" min={0} max={20} defaultValue={0} />
          </Field>
          <Field label="Opens" hint="Optional.">
            <Input name="opensAt" type="datetime-local" />
          </Field>
          <Field label="Closes" hint="Optional.">
            <Input name="closesAt" type="datetime-local" />
          </Field>
        </div>

        <Field label="Why" hint="Optional. For whoever reads this later.">
          <Input name="note" maxLength={200} placeholder="Exam on the 20th, asked for one more mock." />
        </Field>

        <FormError message={state.error} />
        <FormSuccess message={state.ok ? state.message : undefined} />

        <Button type="submit" disabled={pending}>
          {pending ? 'Saving...' : 'Give them this test'}
        </Button>
      </form>

      {grants.length > 0 && (
        <ul className="space-y-2 border-t pt-4">
          {grants.map((g) => (
            <li key={g.id} className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="t-small">
                {g.title}
                <span className="faint"> · {g.detail}</span>
              </span>
              <button
                type="button"
                className="t-small underline"
                style={{ color: 'var(--bad)' }}
                disabled={working}
                onClick={() => remove(withdrawAssessmentGrant, g.id)}
              >
                withdraw
              </button>
            </li>
          ))}
        </ul>
      )}

      {pools.length > 0 && (
        <div className="border-t pt-5">
          <h3 className="t-heading">A set of tests</h3>
          <p className="t-small muted mt-1">
            &ldquo;Any five of these twenty.&rdquo; They choose which, and the count holds across
            whichever they pick.
          </p>

          <form action={poolAction} className="mt-3 space-y-3">
            <input type="hidden" name="userId" value={userId} />

            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Set">
                <Select name="poolId" required defaultValue="">
                  <option value="" disabled>
                    Pick a set
                  </option>
                  {pools.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.count})
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="How many they may take">
                <Input name="allowance" type="number" min={1} max={100} defaultValue={5} />
              </Field>
              <Field label="Expires" hint="Optional.">
                <Input name="expiresAt" type="datetime-local" />
              </Field>
            </div>

            <FormError message={poolState.error} />
            <FormSuccess message={poolState.ok ? poolState.message : undefined} />

            <Button type="submit" variant="secondary" disabled={poolPending}>
              {poolPending ? 'Saving...' : 'Give them this allowance'}
            </Button>
          </form>

          {poolGrants.length > 0 && (
            <ul className="mt-4 space-y-2">
              {poolGrants.map((g) => (
                <li key={g.id} className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="t-small">
                    {g.title}
                    <span className="faint"> · {g.detail}</span>
                  </span>
                  <button
                    type="button"
                    className="t-small underline"
                    style={{ color: 'var(--bad)' }}
                    disabled={working}
                    onClick={() => remove(withdrawPoolGrant, g.id)}
                  >
                    withdraw
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
