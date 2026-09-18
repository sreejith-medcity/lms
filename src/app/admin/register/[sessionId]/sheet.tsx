'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { correctAttendance, submitRegister } from '@/server/register';
import { MARKS, reviewRegister, type Mark } from '@/lib/attendance-rules';
import { Badge, Button, Card, Field, Input } from '@/components/ui';

/**
 * The register on a phone. Three big controls per learner, a running
 * count, a review step that names anyone unmarked, and a save that says
 * when it went through. Marks the teacher has not yet submitted survive a
 * navigation away and back, in this browser only, so a call in the middle
 * of the register does not cost the register.
 */

export interface RosterRow {
  userId: string;
  name: string;
  recorded: Mark | null;
  source: string | null;
  joinedAt: string | null;
  note: string | null;
}

export interface ChangeRow {
  who: string;
  from: Mark | null;
  to: Mark;
  reason: string;
  source: string;
  at: string;
  by: string | null;
}

const TONE: Record<Mark, string> = {
  PRESENT: 'bg-[var(--ok)] text-white border-[var(--ok)]',
  LATE: 'bg-[var(--warn)] text-white border-[var(--warn)]',
  ABSENT: 'bg-[var(--bad)] text-white border-[var(--bad)]',
  EXCUSED: 'bg-[var(--ink-2)] text-white border-[var(--ink-2)]',
};

function markLabel(m: Mark | null): string {
  return m ? (MARKS.find((x) => x.value === m)?.label ?? m) : 'not recorded';
}

export function RegisterSheet({
  sessionId,
  roster,
  confirmed,
  canEdit,
  mayCorrect,
  correctionDays,
  online,
  unrecordedLabel,
  confirmedStarted,
  history,
}: {
  sessionId: string;
  roster: RosterRow[];
  confirmed: boolean;
  canEdit: boolean;
  mayCorrect: boolean;
  correctionDays: number;
  online: boolean;
  unrecordedLabel: string;
  confirmedStarted: boolean;
  history: ChangeRow[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const draftKey = `register.draft.${sessionId}`;
  const [marks, setMarks] = useState<Record<string, Mark | undefined>>({});
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState<string>();
  const [correcting, setCorrecting] = useState<{ userId: string; to: Mark } | null>(null);
  const [reason, setReason] = useState('');

  // The draft: what is marked but not yet submitted.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(draftKey);
      if (raw) setMarks(JSON.parse(raw));
    } catch {
      /* no storage, no draft */
    }
  }, [draftKey]);
  useEffect(() => {
    try {
      if (Object.keys(marks).length) window.localStorage.setItem(draftKey, JSON.stringify(marks));
      else window.localStorage.removeItem(draftKey);
    } catch {
      /* fine */
    }
  }, [marks, draftKey]);

  const review = useMemo(() => reviewRegister(roster, marks), [roster, marks]);
  const dirty = roster.filter((r) => marks[r.userId] && marks[r.userId] !== r.recorded);

  function mark(userId: string, m: Mark, recorded: Mark | null) {
    if (recorded && confirmed) {
      // A confirmed register changes only with a reason.
      if (m !== recorded) setCorrecting({ userId, to: m });
      return;
    }
    setMarks((now) => ({ ...now, [userId]: now[userId] === m ? undefined : m }));
  }

  function markAll(m: Mark) {
    setMarks((now) => {
      const next = { ...now };
      for (const r of roster) if (!(r.recorded && confirmed)) next[r.userId] = m;
      return next;
    });
  }

  function submit() {
    const payload = dirty.map((r) => ({ userId: r.userId, status: marks[r.userId] as Mark }));
    if (payload.length === 0 && !confirmed) {
      // Nothing new to write, but the teacher is confirming what is there.
      const all = roster.filter((r) => r.recorded).map((r) => ({ userId: r.userId, status: r.recorded as Mark }));
      if (all.length === 0) {
        setError('Nobody is marked yet.');
        return;
      }
      start(async () => {
        const res = await submitRegister(sessionId, all);
        if (res.error) setError(res.error);
        else finish(res.message, res.savedAt);
      });
      return;
    }
    start(async () => {
      const res = await submitRegister(sessionId, payload);
      if (res.error) setError(res.error);
      else finish(res.message, res.savedAt);
    });
  }

  function finish(message?: string, savedAt?: string) {
    setError(undefined);
    setMarks({});
    setReviewing(false);
    setSaved(`${message ?? 'Saved.'}${savedAt ? ` ${new Date(savedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : ''}`);
    try {
      window.localStorage.removeItem(draftKey);
    } catch {
      /* fine */
    }
    router.refresh();
  }

  function confirmCorrection() {
    if (!correcting) return;
    start(async () => {
      const res = await correctAttendance(sessionId, correcting.userId, correcting.to, reason);
      if (res.error) setError(res.error);
      else {
        setError(undefined);
        setSaved(res.message);
        setCorrecting(null);
        setReason('');
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-4">
      {online && !confirmedStarted && (
        <p className="t-small rounded-[var(--radius-sm)] border border-dashed p-3">
          The class platform has not reported this class as started, so joins are not coming through. Nobody is marked absent for missing data; mark by hand only what you saw.
        </p>
      )}

      {canEdit && !confirmed && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => markAll('PRESENT')}>
            Everyone present
          </Button>
          <p className="t-micro faint self-center">Then change the ones who were not.</p>
        </div>
      )}

      <Card padded={false}>
        <ul className="divide-y">
          {roster.map((r) => {
            const current = marks[r.userId] ?? r.recorded;
            const locked = Boolean(r.recorded && confirmed);
            return (
              <li key={r.userId} className="px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{r.name}</p>
                    <p className="t-micro faint">
                      {r.recorded ? (
                        <>
                          {markLabel(r.recorded)}
                          {r.source === 'PROVIDER' ? ' · from the platform' : r.source === 'SELF' ? ' · signed in' : r.source === 'CORRECTION' ? ' · corrected' : ''}
                          {r.joinedAt ? ` · joined ${r.joinedAt}` : ''}
                        </>
                      ) : (
                        unrecordedLabel
                      )}
                    </p>
                  </div>
                  {canEdit && (
                    <div className="flex shrink-0 gap-1" role="group" aria-label={`${r.name}: mark`}>
                      {MARKS.filter((m) => m.value !== 'EXCUSED' || current === 'EXCUSED' || locked).map((m) => (
                        <button
                          key={m.value}
                          type="button"
                          disabled={pending || (locked && !mayCorrect)}
                          aria-pressed={current === m.value}
                          title={m.label}
                          onClick={() => mark(r.userId, m.value, r.recorded)}
                          className={`h-11 w-11 rounded-full border text-sm font-semibold transition disabled:opacity-40 ${current === m.value ? TONE[m.value] : 'border-[var(--line-strong)] bg-[var(--surface)] text-[var(--ink-2)]'}`}
                        >
                          {m.short}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      {correcting && (
        <Card>
          <p className="font-medium">
            Change {roster.find((r) => r.userId === correcting.userId)?.name} to {markLabel(correcting.to)}
          </p>
          <p className="t-small muted mt-1">
            The old mark stays on the record with this reason. A parent who was told the earlier mark gets a correction.
          </p>
          <div className="mt-3">
            <Field label="Why">
              <Input value={reason} maxLength={300} autoFocus onChange={(e) => setReason(e.target.value)} />
            </Field>
          </div>
          <div className="mt-3 flex gap-2">
            <Button size="sm" disabled={pending} onClick={confirmCorrection}>
              {pending ? 'Saving…' : 'Save correction'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCorrecting(null)}>
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {confirmed && !mayCorrect && canEdit && (
        <p className="t-micro faint">Registers older than {correctionDays} days are corrected by the Branch Head.</p>
      )}

      {canEdit && !correcting && (
        <div className="sticky bottom-0 -mx-4 border-t bg-[var(--surface)] px-4 py-3 sm:mx-0 sm:rounded-[var(--radius-sm)] sm:border">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm tabular-nums">
            <span>
              <Badge tone="ok">{review.present}</Badge> present
            </span>
            <span>
              <Badge tone="warn">{review.late}</Badge> late
            </span>
            <span>
              <Badge tone="bad">{review.absent}</Badge> absent
            </span>
            {review.excused > 0 && <span>{review.excused} excused</span>}
            <span className="faint">{review.unmarked.length} not recorded</span>
          </div>

          {reviewing ? (
            <div className="mt-3">
              {review.unmarked.length > 0 && (
                <p className="t-small mb-2">
                  Not recorded, and staying that way (not absent): {review.unmarked.join(', ')}.
                </p>
              )}
              <p className="t-small mb-3">
                {review.absent + review.late > 0
                  ? `Confirming tells the parents of ${review.absent + review.late} learner${review.absent + review.late === 1 ? '' : 's'} now.`
                  : 'Nobody absent or late, so no parent alerts go out.'}
              </p>
              <div className="flex gap-2">
                <Button disabled={pending} onClick={submit}>
                  {pending ? 'Saving…' : 'Confirm register'}
                </Button>
                <Button variant="ghost" disabled={pending} onClick={() => setReviewing(false)}>
                  Back
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex items-center gap-3">
              <Button disabled={pending || (dirty.length === 0 && confirmed)} onClick={() => setReviewing(true)}>
                {confirmed ? 'Review changes' : 'Review and confirm'}
              </Button>
              {dirty.length > 0 && <span className="t-micro faint">{dirty.length} unsaved</span>}
            </div>
          )}
          {error && <p className="t-small mt-2 text-[var(--bad)]">{error}</p>}
          {saved && !error && <p className="t-small mt-2 text-[var(--ok)]">{saved}</p>}
        </div>
      )}

      {history.length > 0 && (
        <Card>
          <h2 className="t-heading">Changes</h2>
          <ul className="mt-2 space-y-2">
            {history.map((h, i) => (
              <li key={i} className="t-small">
                <span className="faint tabular-nums">{h.at}</span> {h.who}: {h.from ? `${markLabel(h.from)} to ` : ''}
                {markLabel(h.to)}
                {h.reason ? ` (${h.reason})` : ''}
                {h.by ? <span className="faint"> · {h.by}</span> : null}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
