'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { attachToMarkSheet, correctMarkSheet, decideMarkSheet, deleteMarkSheetDraft, saveMarkSheetEntries, submitMarkSheet } from '@/server/mark-sheets';
import { editable, entryProblem, parseMark, percentOf, type Diff, type Outcome, type SheetReview, type SheetStatus } from '@/lib/mark-sheets';
import { Uploader } from '@/components/uploader';
import { Badge, Button, Card, Field, Input } from '@/components/ui';

/**
 * The entry grid, the review, and the decision.
 *
 * One line per learner: a numeric field (the phone's number keyboard),
 * Absent and Not assessed as buttons rather than a zero, a remark the
 * parent will read, and an override with a reason when the teacher
 * disagrees with the computed grade. Save keeps a draft; Submit sends it
 * to the Branch Head; the Branch Head approves or returns with a reason.
 */

export interface EditorEntry {
  userId: string;
  outcome: Outcome;
  marks: number | null;
  remark: string;
  override: string;
  grade: string | null;
  passed: boolean | null;
  percent: number | null;
}

interface Row {
  outcome: Outcome;
  marks: string;
  remark: string;
  override: string;
}

export function SheetEditor({
  sheetId,
  status,
  superseded,
  correctionInProgress,
  canEdit,
  isApprover,
  submittedByMe,
  maxMarks,
  roster,
  entries,
  review,
  diff,
  files,
}: {
  sheetId: string;
  status: SheetStatus;
  superseded: boolean;
  correctionInProgress: { id: string; version: number } | null;
  canEdit: boolean;
  isApprover: boolean;
  submittedByMe: boolean;
  maxMarks: number;
  roster: { userId: string; name: string }[];
  entries: EditorEntry[];
  review: SheetReview;
  diff: Diff[];
  files: { id: string; fileName: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [note, setNote] = useState<string>();
  const byUser = useMemo(() => new Map(entries.map((e) => [e.userId, e])), [entries]);
  const [rows, setRows] = useState<Record<string, Row>>(() => {
    const out: Record<string, Row> = {};
    for (const r of roster) {
      const e = byUser.get(r.userId);
      out[r.userId] = { outcome: e?.outcome ?? 'SCORED', marks: e?.marks != null ? String(e.marks) : '', remark: e?.remark ?? '', override: e?.override ?? '' };
    }
    return out;
  });
  const [dirty, setDirty] = useState(false);
  const [reason, setReason] = useState('');
  const [deciding, setDeciding] = useState<'PUBLISHED' | 'RETURNED' | null>(null);
  const [correcting, setCorrecting] = useState(false);
  const [showOverride, setShowOverride] = useState<Record<string, boolean>>({});

  const editing = canEdit && editable(status);

  function set(userId: string, patch: Partial<Row>) {
    setRows((now) => ({ ...now, [userId]: { ...now[userId], ...patch } }));
    setDirty(true);
  }

  const localProblems = roster
    .map((r) => {
      const row = rows[r.userId];
      const m = parseMark(row.marks);
      if (row.outcome === 'SCORED' && m === 'bad') return `${r.name} has a mark that is not a number.`;
      const p = entryProblem({ userId: r.userId, outcome: row.outcome, marks: m === 'bad' ? null : m, remark: row.remark, override: row.override }, { maxMarks, passPercent: null, bands: [] });
      return p && !p.startsWith('has no mark') ? `${r.name} ${p}` : null;
    })
    .filter((x): x is string => Boolean(x));

  function save(then?: () => void) {
    start(async () => {
      const res = await saveMarkSheetEntries(sheetId, roster.map((r) => ({ userId: r.userId, ...rows[r.userId] })));
      if (res.error) setError(res.error);
      else {
        setError(undefined);
        setNote(res.message);
        setDirty(false);
        if (then) then();
        else router.refresh();
      }
    });
  }

  function submit() {
    save(() =>
      start(async () => {
        const res = await submitMarkSheet(sheetId);
        if (res.error) setError(res.error);
        else {
          setError(undefined);
          setNote(res.message);
          router.refresh();
        }
      }),
    );
  }

  function decide(decision: 'PUBLISHED' | 'RETURNED') {
    start(async () => {
      const res = await decideMarkSheet(sheetId, decision, reason);
      if (res.error) setError(res.error);
      else {
        setError(undefined);
        setNote(res.message);
        setDeciding(null);
        router.refresh();
      }
    });
  }

  function correct() {
    start(async () => {
      const res = await correctMarkSheet(sheetId, reason);
      if (res.error) setError(res.error);
      else if (res.id) router.push(`/admin/marksheets/${res.id}`);
    });
  }

  const scoredNow = roster.filter((r) => rows[r.userId].outcome === 'SCORED' && parseMark(rows[r.userId].marks) !== null && parseMark(rows[r.userId].marks) !== 'bad').length;

  return (
    <div className="space-y-4">
      {diff.length > 0 && (
        <Card>
          <h2 className="t-heading">What this correction changes</h2>
          <ul className="mt-2 divide-y text-sm">
            {diff.map((d) => (
              <li key={d.userId} className="flex flex-wrap justify-between gap-2 py-2">
                <span className="font-medium">{d.name}</span>
                <span className="tabular-nums">
                  <span className="faint line-through">{d.before}</span> → {d.after}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card padded={false}>
        <ul className="divide-y">
          {roster.map((r) => {
            const row = rows[r.userId];
            const e = byUser.get(r.userId);
            const m = parseMark(row.marks);
            const livePercent = row.outcome === 'SCORED' && m !== null && m !== 'bad' ? percentOf(m, maxMarks) : null;
            return (
              <li key={r.userId} className="px-3 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{r.name}</p>
                    <p className="t-micro faint">
                      {row.outcome === 'ABSENT'
                        ? 'absent'
                        : row.outcome === 'NOT_ASSESSED'
                          ? 'not assessed'
                          : livePercent !== null
                            ? `${livePercent}%${e?.grade && !dirty ? ` · ${e.grade}` : ''}${e?.passed === false && !dirty ? ' · fail' : e?.passed === true && !dirty ? ' · pass' : ''}`
                            : editing
                              ? 'no mark yet'
                              : 'not assessed'}
                      {row.override ? ' · override' : ''}
                    </p>
                  </div>
                  {editing ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        inputMode="decimal"
                        step="0.5"
                        min={0}
                        max={maxMarks}
                        aria-label={`${r.name}: marks out of ${maxMarks}`}
                        className="h-11 w-24 rounded-[var(--radius-sm)] border px-2 text-right text-base tabular-nums disabled:opacity-40"
                        value={row.outcome === 'SCORED' ? row.marks : ''}
                        disabled={row.outcome !== 'SCORED' || pending}
                        onChange={(ev) => set(r.userId, { marks: ev.target.value })}
                      />
                      <button
                        type="button"
                        aria-pressed={row.outcome === 'ABSENT'}
                        className={`h-11 rounded-full border px-3 text-sm font-semibold ${row.outcome === 'ABSENT' ? 'border-[var(--bad)] bg-[var(--bad)] text-white' : 'border-[var(--line-strong)]'}`}
                        onClick={() => set(r.userId, { outcome: row.outcome === 'ABSENT' ? 'SCORED' : 'ABSENT' })}
                      >
                        Abs
                      </button>
                      <button
                        type="button"
                        aria-pressed={row.outcome === 'NOT_ASSESSED'}
                        title="Not assessed"
                        className={`h-11 rounded-full border px-3 text-sm font-semibold ${row.outcome === 'NOT_ASSESSED' ? 'border-[var(--ink-2)] bg-[var(--ink-2)] text-white' : 'border-[var(--line-strong)]'}`}
                        onClick={() => set(r.userId, { outcome: row.outcome === 'NOT_ASSESSED' ? 'SCORED' : 'NOT_ASSESSED' })}
                      >
                        N/A
                      </button>
                    </div>
                  ) : (
                    <div className="text-right tabular-nums">
                      {e?.outcome === 'SCORED' && e.marks !== null ? (
                        <>
                          <span className="font-medium">
                            {e.marks} / {maxMarks}
                          </span>
                          <p className="t-micro faint">
                            {e.percent}%{e.grade ? ` · ${e.grade}` : ''}
                            {e.passed === true ? ' · pass' : e.passed === false ? ' · fail' : ''}
                          </p>
                        </>
                      ) : (
                        <Badge tone="neutral">{e?.outcome === 'ABSENT' ? 'absent' : 'not assessed'}</Badge>
                      )}
                    </div>
                  )}
                </div>
                {editing ? (
                  <div className="mt-2 space-y-2">
                    <input
                      className="w-full rounded-[var(--radius-sm)] border px-2 py-1.5 text-sm"
                      placeholder="Remark the parent will read (optional)"
                      value={row.remark}
                      maxLength={500}
                      onChange={(ev) => set(r.userId, { remark: ev.target.value })}
                    />
                    {showOverride[r.userId] || row.override ? (
                      <input
                        className="w-full rounded-[var(--radius-sm)] border border-dashed px-2 py-1.5 text-sm"
                        placeholder="Override the computed grade or pass: say what and why"
                        value={row.override}
                        maxLength={300}
                        onChange={(ev) => set(r.userId, { override: ev.target.value })}
                      />
                    ) : (
                      <button type="button" className="t-micro faint underline" onClick={() => setShowOverride((s) => ({ ...s, [r.userId]: true }))}>
                        Override grade or pass, with a reason
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                    {e?.remark && <p className="t-small mt-1">{e.remark}</p>}
                    {e?.override && <p className="t-small mt-1 faint">Override: {e.override}</p>}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card>
        <h2 className="t-heading">Files</h2>
        <p className="t-small muted mt-1">The question paper, a scan of the marks, a model answer. Parents can open them once the sheet is published.</p>
        {files.length > 0 && (
          <ul className="mt-2 space-y-1">
            {files.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-2 text-sm">
                <a href={`/api/assets/${f.id}`} target="_blank" rel="noreferrer" className="truncate underline">
                  {f.fileName}
                </a>
                {editing && (
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => { const res = await attachToMarkSheet(sheetId, f.id, false); if (res.error) setError(res.error); else router.refresh(); })}>
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {editing && files.length < 5 && (
          <div className="mt-3">
            <Uploader
              label="Add a file"
              hint="PDF, image or document, up to five."
              onUploaded={(asset) =>
                start(async () => {
                  const res = await attachToMarkSheet(sheetId, asset.id, true);
                  if (res.error) setError(res.error);
                  else router.refresh();
                })
              }
            />
          </div>
        )}
      </Card>

      <div className="sticky bottom-0 -mx-4 border-t bg-[var(--surface)] px-4 py-3 sm:mx-0 sm:rounded-[var(--radius-sm)] sm:border">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm tabular-nums">
          <span>
            <Badge tone="ok">{editing ? scoredNow : review.scored}</Badge> scored
          </span>
          <span>{editing ? roster.filter((r) => rows[r.userId].outcome === 'ABSENT').length : review.absent} absent</span>
          <span>{editing ? roster.filter((r) => rows[r.userId].outcome === 'NOT_ASSESSED').length : review.notAssessed} not assessed</span>
          {!editing && review.average !== null && <span className="faint">average {review.average}% · {review.passed} passed</span>}
        </div>
        {review.missing.length > 0 && status !== 'PUBLISHED' && (
          <p className="t-small mt-1 faint">No line yet: {review.missing.join(', ')}. They will show as not assessed, never as zero.</p>
        )}
        {localProblems.length > 0 && <p className="t-small mt-1 text-[var(--bad)]">{localProblems[0]}</p>}

        {editing && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="secondary" disabled={pending || !dirty} onClick={() => save()}>
              {pending ? 'Saving…' : 'Save draft'}
            </Button>
            <Button disabled={pending || localProblems.length > 0} onClick={submit}>
              Submit for approval
            </Button>
            {status === 'DRAFT' && (
              <Button variant="ghost" disabled={pending} onClick={() => start(async () => { const res = await deleteMarkSheetDraft(sheetId); if (res.error) setError(res.error); else router.push('/admin/marksheets'); })}>
                Discard draft
              </Button>
            )}
          </div>
        )}

        {status === 'SUBMITTED' && isApprover && canEdit && (
          <div className="mt-3">
            {submittedByMe && <p className="t-small mb-2 text-[var(--warn)]">You submitted this sheet, so somebody else approves it.</p>}
            {deciding ? (
              <div className="space-y-2">
                <Field label={deciding === 'RETURNED' ? 'What needs correcting' : 'Note (optional)'}>
                  <Input value={reason} maxLength={500} autoFocus onChange={(e) => setReason(e.target.value)} />
                </Field>
                <div className="flex gap-2">
                  <Button disabled={pending} variant={deciding === 'RETURNED' ? 'danger' : 'primary'} onClick={() => decide(deciding)}>
                    {pending ? 'Saving…' : deciding === 'RETURNED' ? 'Return to teacher' : 'Publish to parents'}
                  </Button>
                  <Button variant="ghost" onClick={() => setDeciding(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button disabled={pending || submittedByMe} onClick={() => setDeciding('PUBLISHED')}>
                  Approve and publish
                </Button>
                <Button variant="secondary" disabled={pending || submittedByMe} onClick={() => setDeciding('RETURNED')}>
                  Return with a reason
                </Button>
              </div>
            )}
          </div>
        )}
        {status === 'SUBMITTED' && !isApprover && <p className="t-small mt-2 faint">Waiting for the Branch Head. You can read it but not change it until it comes back.</p>}

        {status === 'PUBLISHED' && !superseded && canEdit && (
          <div className="mt-3">
            {correctionInProgress ? (
              <p className="t-small">
                A correction (version {correctionInProgress.version}) is in progress.{' '}
                <a className="underline" href={`/admin/marksheets/${correctionInProgress.id}`}>
                  Open it
                </a>
                . This version stays what parents see until it is approved.
              </p>
            ) : correcting ? (
              <div className="space-y-2">
                <Field label="Why is the published result being corrected?">
                  <Input value={reason} maxLength={500} autoFocus onChange={(e) => setReason(e.target.value)} />
                </Field>
                <div className="flex gap-2">
                  <Button disabled={pending || !reason.trim()} onClick={correct}>
                    Start correction
                  </Button>
                  <Button variant="ghost" onClick={() => setCorrecting(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="secondary" onClick={() => setCorrecting(true)}>
                Correct
              </Button>
            )}
          </div>
        )}
        {error && <p className="t-small mt-2 text-[var(--bad)]">{error}</p>}
        {note && !error && <p className="t-small mt-2 text-[var(--ok)]">{note}</p>}
      </div>
    </div>
  );
}
