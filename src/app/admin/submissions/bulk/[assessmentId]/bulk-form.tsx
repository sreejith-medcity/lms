'use client';

import { useActionState, useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { bulkMarkAttempts, remarkObjective } from '@/server/attempts';
import type { ActionState } from '@/server/courses';
import { Badge, Button, Card, Checkbox, FormError, FormSuccess, Input } from '@/components/ui';
import { AnswerView } from '@/components/answer-view';

const initial: ActionState = {};

export interface BulkQuestion {
  id: string;
  type: string;
  prompt: string;
  maxMarks: number;
}

export interface BulkPaperRow {
  attemptId: string;
  learner: string;
  attemptNo: number;
  drafted: boolean;
  aiDraft: string;
  objective: number;
  answers: Record<string, { response: unknown; current: number | null }>;
}

export function BulkMarkForm({
  assessmentId,
  questions,
  papers,
  paperTotal,
  canMark,
  attemptsTotal,
}: {
  assessmentId: string;
  questions: BulkQuestion[];
  papers: BulkPaperRow[];
  paperTotal: number;
  canMark: boolean;
  attemptsTotal: number;
}) {
  const [state, action, pending] = useActionState(bulkMarkAttempts, initial);
  const router = useRouter();
  const [marks, setMarks] = useState<Record<string, number | ''>>({});
  const [view, setView] = useState<'question' | 'learner'>('question');

  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);

  const key = (attemptId: string, questionId: string) => `${attemptId}:${questionId}`;
  const valueFor = (p: BulkPaperRow, q: BulkQuestion) => {
    const typed = marks[key(p.attemptId, q.id)];
    if (typed !== undefined) return typed;
    return p.answers[q.id]?.current ?? '';
  };

  const totals = useMemo(
    () =>
      Object.fromEntries(
        papers.map((p) => {
          let sum = p.objective;
          let complete = true;
          for (const q of questions) {
            const v = valueFor(p, q);
            if (v === '') complete = false;
            else sum += Number(v);
          }
          return [p.attemptId, { sum, complete }];
        }),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [marks, papers, questions],
  );
  const readyCount = Object.values(totals).filter((t) => t.complete).length;

  const box = (p: BulkPaperRow, q: BulkQuestion) => (
    <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
      <Input
        name={`marks:${p.attemptId}:${q.id}`}
        type="number"
        step="0.25"
        min={0}
        max={q.maxMarks}
        value={valueFor(p, q)}
        onChange={(e) => setMarks((m) => ({ ...m, [key(p.attemptId, q.id)]: e.target.value === '' ? '' : Number(e.target.value) }))}
        disabled={!canMark}
        className="w-20"
        aria-label={`Marks for ${p.learner}, out of ${q.maxMarks}`}
      />
      <span className="t-small faint tabular-nums">/ {q.maxMarks}</span>
      {p.drafted && p.answers[q.id]?.current !== null && marks[key(p.attemptId, q.id)] === undefined && <Badge tone="brand">AI draft</Badge>}
    </div>
  );

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="assessmentId" value={assessmentId} />
      <FormError message={state.error} />
      <FormSuccess message={state.ok ? state.message : undefined} />

      {papers.length > 0 && questions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="t-small faint">Read by</span>
          <button type="button" onClick={() => setView('question')} className={`rounded-full border px-3 py-1 text-xs font-medium ${view === 'question' ? 'border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]' : ''}`}>
            question
          </button>
          <button type="button" onClick={() => setView('learner')} className={`rounded-full border px-3 py-1 text-xs font-medium ${view === 'learner' ? 'border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]' : ''}`}>
            learner
          </button>
        </div>
      )}

      {view === 'question'
        ? questions.map((q, qi) => (
            <Card key={q.id}>
              <p className="t-small faint">
                Question {qi + 1} · out of {q.maxMarks}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm font-medium leading-relaxed">{q.prompt}</p>
              <ul className="mt-4 divide-y">
                {papers.map((p) => (
                  <li key={p.attemptId} className="grid gap-3 py-3 lg:grid-cols-[10rem_minmax(0,1fr)_auto]">
                    <span className="t-small font-medium">
                      {p.learner}
                      {p.attemptNo > 1 && <span className="faint"> · attempt {p.attemptNo}</span>}
                    </span>
                    <div className="min-w-0 [&>*]:mt-0">
                      <AnswerView q={{ type: q.type, response: p.answers[q.id]?.response, options: [] }} showKey={false} whose="their" />
                    </div>
                    {box(p, q)}
                  </li>
                ))}
              </ul>
            </Card>
          ))
        : papers.map((p) => (
            <Card key={p.attemptId}>
              <p className="font-medium">
                {p.learner}
                {p.attemptNo > 1 && <span className="t-small faint"> · attempt {p.attemptNo}</span>}
              </p>
              <ul className="mt-3 space-y-4">
                {questions.map((q, qi) => (
                  <li key={q.id}>
                    <p className="t-small faint">
                      Question {qi + 1} · {q.prompt.slice(0, 120)}
                    </p>
                    <div className="[&>*]:mt-1">
                      <AnswerView q={{ type: q.type, response: p.answers[q.id]?.response, options: [] }} showKey={false} whose="their" />
                    </div>
                    <div className="mt-2">{box(p, q)}</div>
                  </li>
                ))}
              </ul>
            </Card>
          ))}

      {papers.length > 0 && (
        <Card>
          <p className="t-small font-medium">Feedback and totals</p>
          <ul className="mt-3 divide-y">
            {papers.map((p) => {
              const t = totals[p.attemptId];
              return (
                <li key={p.attemptId} className="grid gap-2 py-3 sm:grid-cols-[10rem_minmax(0,1fr)_7rem]">
                  <span className="t-small font-medium">{p.learner}</span>
                  <Input name={`feedback:${p.attemptId}`} defaultValue={p.aiDraft} placeholder="A line for the learner (optional)" maxLength={4000} disabled={!canMark} />
                  <span className="t-small tabular-nums sm:text-right">
                    {t.complete ? (
                      <>
                        <span className="font-semibold">{Math.round(t.sum * 100) / 100}</span>
                        <span className="faint"> / {paperTotal}</span>
                      </>
                    ) : (
                      <span className="text-[var(--warn)]">box empty</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <Checkbox name="acceptDrafts" label="Accept the AI examiner's drafts as they stand" hint="Papers whose every box holds a draft are released even if you typed nothing in them." disabled={!canMark} />
            {canMark && (
              <Button type="submit" disabled={pending || papers.length === 0}>
                {pending ? 'Publishing...' : `Mark and release ${readyCount} of ${papers.length}`}
              </Button>
            )}
          </div>
          <p className="t-small faint mt-2">A paper with an empty box is left waiting. Nothing is ever published with a zero you did not type.</p>
        </Card>
      )}

      {canMark && attemptsTotal > 0 && <RemarkObjective assessmentId={assessmentId} attemptsTotal={attemptsTotal} />}
    </form>
  );
}

/** After a key is corrected. Its own control, deliberately not on the main button. */
function RemarkObjective({ assessmentId, attemptsTotal }: { assessmentId: string; attemptsTotal: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [includeReleased, setIncludeReleased] = useState(false);
  const [note, setNote] = useState<string>();
  return (
    <Card>
      <p className="t-small font-medium">Re-mark the objective part</p>
      <p className="t-small muted mt-1">
        For when an answer key was wrong. Every machine-marked answer on every attempt is scored again from the options and keys as they now stand; written marks are kept. Each changed
        paper is written to the audit trail.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="t-small flex items-center gap-2">
          <input type="checkbox" checked={includeReleased} onChange={(e) => setIncludeReleased(e.target.checked)} className="h-4 w-4 accent-[var(--brand)]" />
          Include papers already released ({attemptsTotal} attempt{attemptsTotal === 1 ? '' : 's'} in all)
        </label>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await remarkObjective(assessmentId, includeReleased);
              setNote(res.error ?? res.message);
              if (res.ok) router.refresh();
            })
          }
        >
          {pending ? 'Re-marking...' : 'Re-mark now'}
        </Button>
        {note && <span className="t-small muted">{note}</span>}
      </div>
    </Card>
  );
}
