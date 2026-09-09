'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  sendNow,
  addCredit,
  setWalletThresholds,
  retryFailed,
  cancelQueued,
} from '@/server/messaging';
import type { ActionState } from '@/server/courses';
import { Badge, Button, Card, Field, FormError, FormSuccess, Input } from '@/components/ui';

const initial: ActionState = {};

export interface LogRow {
  id: string;
  channel: string;
  eventKey: string;
  target: string;
  status: string;
  provider: string | null;
  error: string | null;
  cost: string;
  attempts: number;
  at: string;
}

function tone(status: string): 'ok' | 'bad' | 'warn' | 'neutral' {
  if (status === 'SENT' || status === 'DELIVERED' || status === 'READ') return 'ok';
  if (status === 'FAILED') return 'bad';
  if (status === 'SENDING') return 'warn';
  return 'neutral';
}

/** Enough of an address to recognise, not enough to be a contact list. */
function masked(target: string): string {
  if (target.includes('@')) {
    const [name, domain] = target.split('@');
    return `${name.slice(0, 2)}${'*'.repeat(Math.max(1, name.length - 2))}@${domain}`;
  }
  return target.length > 4 ? `${'*'.repeat(target.length - 4)}${target.slice(-4)}` : target;
}

export function MessagingPanel({
  canEdit,
  wallet,
  failed,
  recent,
}: {
  canEdit: boolean;
  wallet: { balance: string; lowRupees: string; floorRupees: string; low: boolean };
  failed: number;
  recent: LogRow[];
}) {
  const router = useRouter();
  const [creditState, creditAction, creditPending] = useActionState(addCredit, initial);
  const [thresholdState, thresholdAction, thresholdPending] = useActionState(
    setWalletThresholds,
    initial,
  );
  const [busy, start] = useTransition();
  const [result, setResult] = useState<ActionState>({});

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-medium">Send what is waiting</p>
            <p className="t-small muted">
              The scheduled run does this every few minutes. This is the same thing, now, for when
              you have just connected something and want to know.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canEdit && (
              <Button
                disabled={busy}
                onClick={() =>
                  start(async () => {
                    setResult(await sendNow());
                    router.refresh();
                  })
                }
              >
                {busy ? 'Sending...' : 'Send now'}
              </Button>
            )}
            {canEdit && failed > 0 && (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  start(async () => {
                    setResult(await retryFailed());
                    router.refresh();
                  })
                }
              >
                Try the {failed} failed again
              </Button>
            )}
          </div>
        </div>

        <FormError message={result.error} />
        <FormSuccess message={result.ok ? result.message : undefined} />
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <p className="font-medium">Credit</p>
          <p className="t-small muted mt-1">
            {wallet.balance} left, on our own estimate of what each message costs. The provider
            bills separately and its figure is the real one; this exists so you find out before
            they do.
          </p>

          {wallet.low && (
            <p className="t-small mt-2">
              <Badge tone="warn">low</Badge> Paid channels stop at the floor rather than going
              negative.
            </p>
          )}

          {canEdit && (
            <form action={creditAction} className="mt-3 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Add credit, in rupees" hint="What you actually paid the provider.">
                  <Input name="rupees" inputMode="decimal" placeholder="5000" />
                </Field>
                <Field label="Note" hint="Optional. The invoice number is useful here.">
                  <Input name="note" placeholder="MSG91 invoice 4471" />
                </Field>
              </div>
              <FormError message={creditState.error} />
              <FormSuccess message={creditState.ok ? creditState.message : undefined} />
              <Button type="submit" disabled={creditPending}>
                {creditPending ? 'Adding...' : 'Add'}
              </Button>
            </form>
          )}
        </Card>

        <Card>
          <p className="font-medium">When to worry</p>
          <p className="t-small muted mt-1">
            The warning level is when the screen says low. The floor is where paid channels stop
            sending, so leave it at zero unless you want a hard reserve.
          </p>

          {canEdit && (
            <form action={thresholdAction} className="mt-3 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Warn below" hint="Rupees. Zero never warns.">
                  <Input name="lowRupees" defaultValue={wallet.lowRupees} inputMode="decimal" />
                </Field>
                <Field label="Stop below" hint="Rupees. Usually zero.">
                  <Input name="floorRupees" defaultValue={wallet.floorRupees} inputMode="decimal" />
                </Field>
              </div>
              <FormError message={thresholdState.error} />
              <FormSuccess message={thresholdState.ok ? thresholdState.message : undefined} />
              <Button type="submit" variant="secondary" disabled={thresholdPending}>
                {thresholdPending ? 'Saving...' : 'Save'}
              </Button>
            </form>
          )}
        </Card>
      </div>

      <section className="space-y-3">
        <div>
          <h2 className="t-heading">The last 25</h2>
          <p className="t-small muted">
            Addresses are masked here. This screen is for finding out whether messages are going
            out, not for reading them or copying a contact list out of the product.
          </p>
        </div>

        {recent.length === 0 && (
          <Card>
            <p className="t-small muted">Nothing has been queued yet.</p>
          </Card>
        )}

        {recent.length > 0 && (
          <Card>
            <ul className="divide-y">
              {recent.map((row) => (
                <li key={row.id} className="flex flex-wrap items-baseline gap-2 py-2">
                  <Badge tone={tone(row.status)}>{row.status.toLowerCase()}</Badge>
                  <span className="t-small font-medium">{row.eventKey}</span>
                  <span className="t-small muted">{row.channel.toLowerCase()}</span>
                  <span className="t-small faint">{masked(row.target)}</span>
                  {row.provider && <span className="t-small faint">via {row.provider}</span>}
                  {row.attempts > 1 && (
                    <span className="t-small faint">{row.attempts} tries</span>
                  )}
                  <span className="t-small faint ml-auto">
                    {new Date(row.at).toLocaleString('en-IN')}
                  </span>
                  {row.error && <p className="t-small faint w-full">{row.error}</p>}
                  {canEdit && (row.status === 'QUEUED' || row.status === 'FAILED') && (
                    <button
                      type="button"
                      className="t-small faint hover:text-[var(--bad)]"
                      disabled={busy}
                      onClick={() =>
                        start(async () => {
                          setResult(await cancelQueued(row.id));
                          router.refresh();
                        })
                      }
                    >
                      Cancel
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}
