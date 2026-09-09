'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { runStep, testStore, type Step, type StepState } from '@/server/migration';
import type { ActionState } from '@/server/courses';
import { Badge, Button, Card, FormError, FormSuccess } from '@/components/ui';

const STEPS: { key: Step; title: string; blurb: string; caution?: string }[] = [
  {
    key: 'customers',
    title: 'Customers',
    blurb:
      'Matched on email. Somebody already here is linked to their old id and otherwise left alone, because the record here is the newer one.',
    caution:
      'Nobody is given a password. They sign in with a code, or set one through the forgotten-password flow. Inventing passwords and emailing them out is how a migration becomes a security incident.',
  },
  {
    key: 'products',
    title: 'Product URLs',
    blurb:
      'Reads the store permalinks and proposes a redirect for each one, matched to a course with the same slug.',
    caution:
      'The products themselves are not copied. The courses here are properly authored with modules and pricing; a store product is a title and a price, and importing them would leave four hundred shells to delete.',
  },
  {
    key: 'orders',
    title: 'Order history',
    blurb:
      'Kept so that "what did I buy in 2024" still has an answer once the old store is switched off.',
    caution:
      'Held as history rather than written into the live ledger, and never turned into enrolments. What somebody bought there is a question for a person, and a guess either grants access nobody paid for or withholds access somebody did. Mixing old orders into this ledger would also make every settlement and tax report wrong for the periods they touch.',
  },
];

export function MigrationConsole({
  connected,
  canApply,
  done,
}: {
  connected: boolean;
  canApply: boolean;
  done: { entity: string; migrated: number }[];
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [results, setResults] = useState<Record<string, StepState>>({});
  const [connection, setConnection] = useState<ActionState>({});
  const [confirming, setConfirming] = useState<Step | null>(null);

  const alreadyDone = new Map(done.map((row) => [row.entity, row.migrated]));

  function run(step: Step, apply: boolean) {
    start(async () => {
      const result = await runStep(step, apply);
      setResults((prev) => ({ ...prev, [step]: result }));
      setConfirming(null);
      if (apply) router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-medium">Is the store reachable</p>
            <p className="t-small muted">
              Worth checking first. The usual reason this fails is permalinks set to plain, which
              removes the REST routes entirely.
            </p>
          </div>
          <Button
            variant="secondary"
            disabled={busy || !connected}
            onClick={() =>
              start(async () => {
                setConnection(await testStore());
              })
            }
          >
            {busy ? 'Checking...' : 'Check'}
          </Button>
        </div>
        <FormError message={connection.error} />
        <FormSuccess message={connection.ok ? connection.message : undefined} />
      </Card>

      {STEPS.map((step) => {
        const result = results[step.key];
        const migrated = alreadyDone.get(step.key === 'products' ? 'product' : step.key.slice(0, -1));

        return (
          <Card key={step.key}>
            <p className="flex flex-wrap items-center gap-2 font-medium">
              {step.title}
              {migrated ? <Badge tone="ok">{migrated} already across</Badge> : null}
            </p>
            <p className="t-small muted mt-1">{step.blurb}</p>
            {step.caution && <p className="t-small faint mt-1">{step.caution}</p>}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                disabled={busy || !connected}
                onClick={() => run(step.key, false)}
              >
                {busy ? 'Working...' : 'Rehearse'}
              </Button>

              {canApply && confirming !== step.key && (
                <Button
                  disabled={busy || !connected || !result}
                  onClick={() => setConfirming(step.key)}
                >
                  Do it for real
                </Button>
              )}

              {canApply && confirming === step.key && (
                <>
                  <Button disabled={busy} onClick={() => run(step.key, true)}>
                    {busy ? 'Running...' : 'Yes, write it'}
                  </Button>
                  <button
                    type="button"
                    className="t-small faint hover:underline"
                    onClick={() => setConfirming(null)}
                  >
                    Cancel
                  </button>
                </>
              )}

              {!result && canApply && (
                <span className="t-small faint">Rehearse it first.</span>
              )}
            </div>

            {result && (
              <div className="mt-3 border-t pt-3">
                <FormError message={result.error} />
                <FormSuccess message={result.ok ? result.message : undefined} />

                {result.report && (
                  <div className="t-small muted mt-2 space-y-1">
                    <p>
                      Looked at {result.report.looked}. {result.report.wouldCreate} new,{' '}
                      {result.report.wouldUpdate} to link, {result.report.alreadyDone} already done.
                    </p>

                    {result.report.samples.length > 0 && (
                      <ul className="font-mono text-xs">
                        {result.report.samples.map((sample) => (
                          <li key={sample}>{sample}</li>
                        ))}
                      </ul>
                    )}

                    {result.report.problems.length > 0 && (
                      <div className="rounded-[var(--radius-sm)] bg-[var(--surface-2)] p-3">
                        <p className="font-medium">Worth knowing before you commit</p>
                        <ul className="mt-1 space-y-1">
                          {result.report.problems.slice(0, 8).map((problem) => (
                            <li key={problem}>{problem}</li>
                          ))}
                        </ul>
                        {result.report.problems.length > 8 && (
                          <p className="faint mt-1">
                            and {result.report.problems.length - 8} more of the same kind.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
