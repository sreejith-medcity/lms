'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { $Enums } from '@prisma/client';
import { assignBatchStaff, endBatchStaff } from '@/server/batch';
import { assignmentImpact, assignmentState } from '@/lib/scope-rules';
import { Badge, Button, Card, Field, Input, Select } from '@/components/ui';

/**
 * Who teaches or manages this batch, from when to when. The Branch Head
 * reads what a change does to access before pressing save; an ended
 * assignment stays on the list, greyed, because the batch's history of who
 * taught it is this table.
 */

export interface AssignmentRow {
  userId: string;
  name: string;
  role: $Enums.BatchRole;
  startsOn: string | null;
  endsOn: string | null;
  note: string | null;
  assignedBy: string | null;
  assignedAt: string;
}

export interface AssignmentEvent {
  at: string;
  who: string | null;
  line: string;
}

const ROLES: { value: $Enums.BatchRole; label: string; hint: string }[] = [
  { value: 'PRIMARY_TUTOR', label: 'Teacher', hint: 'Keeps the register, enters marks, sees the learners' },
  { value: 'BATCH_MANAGER', label: 'Manager', hint: 'Owns the batch' },
  { value: 'ADDITIONAL_MANAGER', label: 'Co-manager', hint: 'Shares the batch' },
  { value: 'ASSISTANT', label: 'Assistant', hint: 'Helps out' },
];

function roleLabel(role: string) {
  return ROLES.find((r) => r.value === role)?.label ?? role;
}

function toDate(s: string | null): Date | null {
  return s ? new Date(s) : null;
}

export function Assignments({
  batchId,
  rows,
  team,
  history,
  canEdit,
}: {
  batchId: string;
  rows: AssignmentRow[];
  team: { id: string; name: string }[];
  history: AssignmentEvent[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [userId, setUserId] = useState(team[0]?.id ?? '');
  const [role, setRole] = useState<$Enums.BatchRole>('PRIMARY_TUTOR');
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [note, setNote] = useState('');
  const [ending, setEnding] = useState<{ userId: string; role: $Enums.BatchRole; endsOn: string } | null>(null);

  const today = useMemo(() => new Date(), []);
  const nameOf = (id: string) => team.find((t) => t.id === id)?.name ?? rows.find((r) => r.userId === id)?.name ?? 'Somebody';
  const current = rows.map((r) => ({ userId: r.userId, role: r.role, startsOn: toDate(r.startsOn), endsOn: toDate(r.endsOn) }));

  const impact = userId
    ? assignmentImpact({ current, change: { userId, role, startsOn: toDate(startsOn || null), endsOn: toDate(endsOn || null) }, today }, nameOf)
    : [];
  const endImpact = ending
    ? assignmentImpact({ current, change: { end: { userId: ending.userId, role: ending.role, endsOn: new Date(ending.endsOn) } }, today }, nameOf)
    : [];

  const sorted = [...rows].sort((a, b) => {
    const sa = assignmentState({ startsOn: toDate(a.startsOn), endsOn: toDate(a.endsOn) }, today);
    const sb = assignmentState({ startsOn: toDate(b.startsOn), endsOn: toDate(b.endsOn) }, today);
    const order = { active: 0, upcoming: 1, ended: 2 };
    return order[sa] - order[sb] || a.name.localeCompare(b.name);
  });

  function assign() {
    start(async () => {
      const res = await assignBatchStaff({ batchId, userId, role, startsOn: startsOn || null, endsOn: endsOn || null, note: note || null });
      if (res.error) setError(res.error);
      else {
        setError(undefined);
        setNote('');
        router.refresh();
      }
    });
  }

  function confirmEnd() {
    if (!ending) return;
    start(async () => {
      const res = await endBatchStaff(batchId, ending.userId, ending.role, ending.endsOn);
      if (res.error) setError(res.error);
      else {
        setError(undefined);
        setEnding(null);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="t-heading">Who runs it</h2>
        <p className="t-small muted mt-1">
          A teacher sees this batch, its learners and its academic history between the dates on
          their assignment, and nothing of the branch beyond it. Never fees.
        </p>

        {sorted.length === 0 ? (
          <p className="t-small faint mt-4">Nobody is assigned. The batch does not appear on any teacher&rsquo;s desk.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b">
                  <th className="t-micro faint py-2 text-left font-semibold">Person</th>
                  <th className="t-micro faint px-2 py-2 text-left font-semibold">As</th>
                  <th className="t-micro faint px-2 py-2 text-left font-semibold">From</th>
                  <th className="t-micro faint px-2 py-2 text-left font-semibold">To</th>
                  <th className="t-micro faint px-2 py-2 text-left font-semibold">State</th>
                  {canEdit && <th className="py-2" />}
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => {
                  const state = assignmentState({ startsOn: toDate(r.startsOn), endsOn: toDate(r.endsOn) }, today);
                  const isEnding = ending?.userId === r.userId && ending?.role === r.role;
                  return (
                    <tr key={`${r.userId}:${r.role}`} className={`border-b last:border-0 ${state === 'ended' ? 'opacity-60' : ''}`}>
                      <td className="py-2">
                        {r.name}
                        {r.note && <p className="t-micro faint">{r.note}</p>}
                      </td>
                      <td className="px-2 py-2">{roleLabel(r.role)}</td>
                      <td className="px-2 py-2 tabular-nums">{r.startsOn ? r.startsOn.slice(0, 10) : 'open'}</td>
                      <td className="px-2 py-2 tabular-nums">{r.endsOn ? r.endsOn.slice(0, 10) : 'open'}</td>
                      <td className="px-2 py-2">
                        <Badge tone={state === 'active' ? 'ok' : state === 'upcoming' ? 'neutral' : 'warn'}>{state}</Badge>
                      </td>
                      {canEdit && (
                        <td className="py-2 text-right">
                          {state !== 'ended' && !isEnding && (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={pending}
                              onClick={() => setEnding({ userId: r.userId, role: r.role, endsOn: today.toISOString().slice(0, 10) })}
                            >
                              End
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {ending && (
          <div className="mt-4 rounded-[var(--radius-sm)] border p-4">
            <p className="font-medium">End {nameOf(ending.userId)}&rsquo;s assignment as {roleLabel(ending.role)}</p>
            <div className="mt-3 max-w-xs">
              <Field label="Last day">
                <Input type="date" value={ending.endsOn} onChange={(e) => setEnding({ ...ending, endsOn: e.target.value })} />
              </Field>
            </div>
            <ul className="t-small muted mt-3 list-disc space-y-1 pl-5">
              {endImpact.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <div className="mt-3 flex gap-2">
              <Button size="sm" disabled={pending} onClick={confirmEnd}>
                {pending ? 'Ending…' : 'End assignment'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEnding(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        {error && <p className="t-small mt-3 text-[var(--bad)]">{error}</p>}
      </Card>

      {canEdit && (
        <Card>
          <h2 className="t-heading">Assign</h2>
          <p className="t-small muted mt-1">
            Read what the change does before saving. To replace a teacher, assign the new one
            and end the old one; both stay on the list.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Person">
              <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
                {team.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="As" hint={ROLES.find((r) => r.value === role)?.hint}>
              <Select value={role} onChange={(e) => setRole(e.target.value as $Enums.BatchRole)}>
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="From" hint="Blank means from now">
              <Input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
            </Field>
            <Field label="To" hint="Blank means until ended">
              <Input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
            </Field>
          </div>
          <div className="mt-4">
            <Field label="Note" hint="Optional: why, or what they cover">
              <Input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
          {impact.length > 0 && (
            <ul className="t-small muted mt-4 list-disc space-y-1 pl-5">
              {impact.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          <div className="mt-4">
            <Button disabled={pending || !userId} onClick={assign}>
              {pending ? 'Saving…' : 'Assign'}
            </Button>
          </div>
        </Card>
      )}

      {history.length > 0 && (
        <Card>
          <h2 className="t-heading">History</h2>
          <ul className="mt-3 space-y-2">
            {history.map((h, i) => (
              <li key={i} className="t-small">
                <span className="faint tabular-nums">{h.at.slice(0, 10)}</span> {h.line}
                {h.who && <span className="faint"> · by {h.who}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
