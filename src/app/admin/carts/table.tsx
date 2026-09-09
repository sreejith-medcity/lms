'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { nudgeCarts, dismissCart } from '@/server/cart';
import type { ActionState } from '@/server/courses';
import { formatMoney } from '@/lib/money';
import { Badge, Button, Cell, FormError, FormSuccess, Row, Table } from '@/components/ui';

export interface CartRow {
  id: string;
  status: string;
  visitCount: number;
  learnerId: string | null;
  name: string;
  contact: string;
  reachable: boolean;
  courses: string[];
  valuePaise: number;
  currency: string;
  quietSince: string;
}

function since(iso: string) {
  const hours = Math.round((Date.now() - new Date(iso).getTime()) / 3600_000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

export function CartTable({ rows, canEdit }: { rows: CartRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState<string[]>([]);
  const [state, setState] = useState<ActionState>({});

  const nudgeable = useMemo(
    () => rows.filter((r) => r.status === 'ABANDONED' && r.reachable).map((r) => r.id),
    [rows],
  );

  function run(work: () => Promise<ActionState>) {
    start(async () => {
      const res = await work();
      setState(res);
      if (!res.error) {
        setSelected([]);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-3">
      {canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="t-small faint">
            {selected.length > 0
              ? `${selected.length} selected`
              : 'Tick the ones worth chasing'}
          </span>
          <Button
            size="sm"
            disabled={pending || selected.length === 0}
            onClick={() => run(() => nudgeCarts(selected))}
          >
            Queue a nudge
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={pending || nudgeable.length === 0}
            onClick={() => setSelected(nudgeable)}
          >
            Select all reachable
          </Button>
        </div>
      )}

      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />

      <Table head={[canEdit ? '' : '', 'Learner', 'Looking at', 'Value', 'Visits', 'Quiet since', '']}>
        {rows.map((r) => (
          <Row key={r.id}>
            <Cell className="w-10">
              {canEdit && (
                <input
                  type="checkbox"
                  aria-label={`Select ${r.name}`}
                  className="h-4 w-4 rounded border-[var(--line-strong)] accent-[var(--brand)]"
                  disabled={!r.reachable || r.status !== 'ABANDONED'}
                  checked={selected.includes(r.id)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked ? [...selected, r.id] : selected.filter((id) => id !== r.id),
                    )
                  }
                />
              )}
            </Cell>
            <Cell>
              {r.learnerId ? (
                <Link href={`/admin/learners/${r.learnerId}`} className="font-medium hover:underline">
                  {r.name}
                </Link>
              ) : (
                <span className="font-medium">{r.name}</span>
              )}
              <p className="t-micro faint">{r.contact || 'no contact details'}</p>
            </Cell>
            <Cell className="muted">
              {r.courses.length === 0
                ? '—'
                : r.courses.length === 1
                  ? r.courses[0]
                  : `${r.courses[0]} and ${r.courses.length - 1} more`}
            </Cell>
            <Cell className="tabular-nums">{formatMoney(r.valuePaise, r.currency)}</Cell>
            <Cell className="tabular-nums">
              {r.visitCount}
              {r.visitCount > 1 && (
                <span className="ml-2">
                  <Badge tone="warn">keeps coming back</Badge>
                </span>
              )}
            </Cell>
            <Cell className="t-small faint">{since(r.quietSince)}</Cell>
            <Cell className="text-right">
              {r.status === 'OPEN' ? (
                <Badge tone="brand">still shopping</Badge>
              ) : canEdit ? (
                <button
                  type="button"
                  className="t-small faint hover:underline"
                  disabled={pending}
                  onClick={() => run(() => dismissCart(r.id))}
                >
                  Dismiss
                </button>
              ) : (
                <Badge tone="neutral">abandoned</Badge>
              )}
            </Cell>
          </Row>
        ))}
      </Table>
    </div>
  );
}
