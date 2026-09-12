'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveAnswer, startSection, submitAttempt, uploadAnswer } from '@/server/attempts';
import { Button, Card, Textarea } from '@/components/ui';
import { QuestionMedia } from '@/components/answer-view';
import { SPEAKING_MAX_SECONDS, isAnswered, splitBlanks, uploadedAnswer } from '@/lib/question-scoring';

export interface PaperQuestion {
  id: string;
  type: string;
  prompt: string;
  marks: number;
  negative: number;
  sectionId: string | null;
  media: { url: string; kind: string } | null;
  options: { id: string; label: string }[];
  /** How many gaps a fill-in question has. */
  blanks: number;
  /** Left column in order; right column already shuffled, each carrying its true index. */
  match: { left: string[]; right: { index: number; label: string }[] } | null;
  /** Items already shuffled, each carrying its true index. */
  ordering: { index: number; label: string }[] | null;
  saved: unknown;
}

export interface PaperSection {
  id: string;
  title: string;
  instructions: string | null;
  durationMinutes: number | null;
  startedAt: string | null;
  endsAt: string | null;
  state: 'OPEN' | 'NOT_STARTED' | 'CLOSED';
}

type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

/**
 * The paper.
 *
 * Every answer is written on its own as it is given, so a dropped connection
 * costs the last answer rather than the whole sitting. The countdown is read
 * from a server-issued end time and only ever tells the learner what to expect;
 * the server refuses a late answer regardless of what this clock says.
 *
 * A paper with sections shows one section at a time. A section with a clock
 * of its own starts when the learner presses Start, runs down on its own,
 * and closes for good; the paper's clock runs over all of it.
 */
export function Paper({
  attemptId,
  title,
  endsAt,
  sections,
  questions,
}: {
  attemptId: string;
  title: string;
  endsAt: string | null;
  sections: PaperSection[];
  questions: PaperQuestion[];
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(questions.filter((q) => q.saved != null).map((q) => [q.id, q.saved])),
  );
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({});
  const [secondsLeft, setSecondsLeft] = useState<number | null>(
    endsAt ? Math.max(0, Math.floor((new Date(endsAt).getTime() - Date.now()) / 1000)) : null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Sections, as the browser knows them; the server's word still wins.
  const [secs, setSecs] = useState(sections);
  const groups = useMemo(() => {
    if (secs.length === 0) return [{ id: null as string | null, title: null as string | null, questions }];
    const loose = questions.filter((q) => !q.sectionId || !secs.some((s) => s.id === q.sectionId));
    const out: { id: string | null; title: string | null; questions: PaperQuestion[] }[] = [];
    if (loose.length) out.push({ id: null, title: 'General', questions: loose });
    for (const s of secs) out.push({ id: s.id, title: s.title, questions: questions.filter((q) => q.sectionId === s.id) });
    return out;
  }, [secs, questions]);
  const [groupIndex, setGroupIndex] = useState(() => {
    // Open on the first section still to be done.
    const i = groups.findIndex((g) => {
      const s = g.id ? secs.find((x) => x.id === g.id) : null;
      return !s || s.state !== 'CLOSED';
    });
    return i < 0 ? 0 : i;
  });
  const group = groups[Math.min(groupIndex, groups.length - 1)];
  const section = group.id ? secs.find((s) => s.id === group.id) ?? null : null;
  const [sectionLeft, setSectionLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!section?.endsAt || section.state !== 'OPEN') {
      setSectionLeft(null);
      return;
    }
    const tick = () => {
      const left = Math.floor((new Date(section.endsAt!).getTime() - Date.now()) / 1000);
      setSectionLeft(Math.max(0, left));
      if (left <= 0) setSecs((all) => all.map((s) => (s.id === section.id ? { ...s, state: 'CLOSED' } : s)));
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [section]);

  const persist = useCallback(
    async (questionId: string, response: unknown) => {
      setSaveState((s) => ({ ...s, [questionId]: 'saving' }));
      const res = await saveAnswer(attemptId, questionId, response);
      if (res.expired) {
        router.replace(`/learn/attempt/${attemptId}`);
        return;
      }
      if (res.sectionClosed) {
        const q = questions.find((x) => x.id === questionId);
        if (q?.sectionId) setSecs((all) => all.map((s) => (s.id === q.sectionId ? { ...s, state: 'CLOSED' } : s)));
      }
      setSaveState((s) => ({ ...s, [questionId]: res.error ? 'failed' : 'saved' }));
    },
    [attemptId, router, questions],
  );

  const setAnswer = useCallback(
    (questionId: string, response: unknown, debounce = 0) => {
      setAnswers((a) => ({ ...a, [questionId]: response }));
      clearTimeout(timers.current[questionId]);
      if (debounce > 0) {
        timers.current[questionId] = setTimeout(() => void persist(questionId, response), debounce);
      } else {
        void persist(questionId, response);
      }
    },
    [persist],
  );

  const submit = useCallback(
    async (auto = false) => {
      setSubmitting(true);
      for (const [id, timer] of Object.entries(timers.current)) {
        clearTimeout(timer);
        if (answers[id] != null) await persist(id, answers[id]);
      }
      const res = await submitAttempt(attemptId);
      if (res.error && !auto) {
        setError(res.error);
        setSubmitting(false);
        return;
      }
      router.replace(`/learn/attempt/${attemptId}`);
    },
    [answers, attemptId, persist, router],
  );

  useEffect(() => {
    if (secondsLeft == null) return;
    if (secondsLeft <= 0) {
      void submit(true);
      return;
    }
    const t = setTimeout(() => setSecondsLeft((s) => (s == null ? null : s - 1)), 1000);
    return () => clearTimeout(t);
  }, [secondsLeft, submit]);

  const open = useCallback(async () => {
    if (!section) return;
    const res = await startSection(attemptId, section.id);
    if (res.error || !res.startedAt) {
      setError(res.error ?? 'Could not start the section.');
      return;
    }
    const startedAt = res.startedAt;
    const endsAt = new Date(new Date(startedAt).getTime() + (section.durationMinutes ?? 0) * 60_000).toISOString();
    setSecs((all) => all.map((s) => (s.id === section.id ? { ...s, startedAt, endsAt, state: 'OPEN' } : s)));
  }, [attemptId, section]);

  const answered = questions.filter((q) => isAnswered(q.type, answers[q.id])).length;
  const low = secondsLeft != null && secondsLeft <= 120;
  const locked = section?.state !== undefined && section.state !== 'OPEN';
  const lastGroup = groupIndex >= groups.length - 1;

  return (
    <div className="mx-auto max-w-3xl px-5 py-7">
      <div className="sticky top-14 z-10 -mx-5 mb-6 border-b bg-[var(--canvas)]/95 px-5 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold">{title}</h1>
            <p className="t-small faint tabular-nums">
              {answered} of {questions.length} answered
            </p>
          </div>

          <div className="flex items-center gap-3">
            {sectionLeft != null && (
              <span className="t-small tabular-nums" style={{ color: sectionLeft <= 60 ? 'var(--bad)' : 'var(--ink-2)' }}>
                section {clock(sectionLeft)}
              </span>
            )}
            {secondsLeft != null && (
              <span
                className="text-lg font-semibold tabular-nums"
                style={{ color: low ? 'var(--bad)' : 'var(--ink)' }}
                aria-live={low ? 'assertive' : 'off'}
              >
                {clock(secondsLeft)}
              </span>
            )}
            <Button disabled={submitting} onClick={() => void submit()}>
              {submitting ? 'Submitting...' : 'Submit'}
            </Button>
          </div>
        </div>

        {low && (
          <p className="t-small mt-2 text-[var(--bad)]">
            Under two minutes. The paper submits itself when the clock runs out, with whatever is answered.
          </p>
        )}

        {groups.length > 1 && (
          <nav className="mt-3 flex gap-1 overflow-x-auto" aria-label="Sections">
            {groups.map((g, i) => {
              const st = g.id ? secs.find((s) => s.id === g.id)?.state : 'OPEN';
              return (
                <button
                  key={g.id ?? 'general'}
                  type="button"
                  onClick={() => setGroupIndex(i)}
                  className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium ${
                    i === groupIndex ? 'border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]' : st === 'CLOSED' ? 'faint' : ''
                  }`}
                >
                  {g.title}
                  {st === 'CLOSED' ? ' · closed' : ''}
                </button>
              );
            })}
          </nav>
        )}
      </div>

      {error && <p className="t-small mb-4 text-[var(--bad)]">{error}</p>}

      {section && (
        <Card className="mb-4">
          <h2 className="font-semibold">{section.title}</h2>
          {section.instructions && <p className="t-small muted mt-1 whitespace-pre-wrap">{section.instructions}</p>}
          {section.durationMinutes ? (
            section.state === 'NOT_STARTED' ? (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button onClick={() => void open()}>Start this section · {section.durationMinutes} min</Button>
                <p className="t-small faint">Its clock starts when you press, and does not stop.</p>
              </div>
            ) : section.state === 'CLOSED' ? (
              <p className="t-small mt-3 text-[var(--warn)]">This section has closed. Its answers are kept as they were.</p>
            ) : (
              <p className="t-small faint mt-2">{section.durationMinutes} minutes for this section.</p>
            )
          ) : null}
        </Card>
      )}

      {section?.state === 'NOT_STARTED' ? null : (
        <ol className="space-y-4">
          {group.questions.map((q, i) => (
            <li key={q.id}>
              <Card>
                <div className="flex items-start justify-between gap-3">
                  <p className="t-small faint tabular-nums">
                    Question {i + 1} of {group.questions.length}
                  </p>
                  <p className="t-small faint shrink-0 tabular-nums">
                    {q.marks} mark{q.marks === 1 ? '' : 's'}
                    {q.negative > 0 ? `, −${q.negative} if wrong` : ''}
                  </p>
                </div>

                <QuestionMedia media={q.media} />

                {q.type === 'FILL_BLANK' ? (
                  <BlankInput q={q} value={answers[q.id]} disabled={locked} onChange={(v) => setAnswer(q.id, v, 800)} onBlur={(v) => setAnswer(q.id, v)} />
                ) : (
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{q.prompt}</p>
                )}

                <div className="mt-4">
                  {q.options.length > 0 ? (
                    <ChoiceInput q={q} value={answers[q.id]} disabled={locked} onChange={(v) => setAnswer(q.id, v)} />
                  ) : q.type === 'MATCH' && q.match ? (
                    <MatchInput q={q} value={answers[q.id]} disabled={locked} onChange={(v) => setAnswer(q.id, v)} />
                  ) : q.type === 'ORDERING' && q.ordering ? (
                    <OrderInput q={q} value={answers[q.id]} disabled={locked} onChange={(v) => setAnswer(q.id, v)} />
                  ) : q.type === 'FILE_UPLOAD' ? (
                    <UploadInput attemptId={attemptId} q={q} value={answers[q.id]} disabled={locked} onSaved={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))} />
                  ) : q.type === 'SPEAKING' ? (
                    <SpeakingInput attemptId={attemptId} q={q} value={answers[q.id]} disabled={locked} onSaved={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))} />
                  ) : q.type === 'FILL_BLANK' ? null : (
                    <Textarea
                      rows={q.type === 'LONG_ANSWER' ? 8 : 3}
                      value={(answers[q.id] as string | undefined) ?? ''}
                      onChange={(e) => setAnswer(q.id, e.target.value, 1200)}
                      onBlur={(e) => setAnswer(q.id, e.target.value)}
                      placeholder="Your answer"
                      maxLength={20000}
                      disabled={locked}
                    />
                  )}
                </div>

                <p className="t-micro faint mt-2 h-4">
                  {saveState[q.id] === 'saving' && 'Saving...'}
                  {saveState[q.id] === 'saved' && 'Saved'}
                  {saveState[q.id] === 'failed' && <span className="text-[var(--bad)]">Not saved. Check your connection.</span>}
                </p>
              </Card>
            </li>
          ))}
          {group.questions.length === 0 && <p className="t-small faint">No questions in this section.</p>}
        </ol>
      )}

      <div className="mt-6 flex flex-wrap justify-end gap-2">
        {groups.length > 1 && !lastGroup && (
          <Button size="lg" variant="secondary" onClick={() => setGroupIndex((i) => i + 1)}>
            Next section
          </Button>
        )}
        {(groups.length === 1 || lastGroup) && (
          <Button size="lg" disabled={submitting} onClick={() => void submit()}>
            {submitting ? 'Submitting...' : 'Submit paper'}
          </Button>
        )}
      </div>
    </div>
  );
}

/* Inputs ------------------------------------------------------------------- */

function ChoiceInput({ q, value, disabled, onChange }: { q: PaperQuestion; value: unknown; disabled: boolean; onChange: (v: string[]) => void }) {
  const current = (Array.isArray(value) ? (value as string[]) : []) ?? [];
  const multi = q.type === 'MCQ_MULTI';
  return (
    <ul className="space-y-1.5">
      {q.options.map((o) => {
        const checked = current.includes(o.id);
        return (
          <li key={o.id}>
            <label
              className={`flex items-start gap-3 rounded-[var(--radius-sm)] border p-3 text-sm transition ${disabled ? 'opacity-70' : 'cursor-pointer'} ${
                checked ? 'border-[var(--brand)] bg-[var(--brand-soft)]' : disabled ? '' : 'hover:bg-[var(--surface-2)]'
              }`}
            >
              <input
                type={multi ? 'checkbox' : 'radio'}
                name={q.id}
                checked={checked}
                disabled={disabled}
                onChange={() => onChange(multi ? (checked ? current.filter((id) => id !== o.id) : [...current, o.id]) : [o.id])}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--brand)]"
              />
              <span>{o.label}</span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

/** The prompt with an input in each gap. */
function BlankInput({ q, value, disabled, onChange, onBlur }: { q: PaperQuestion; value: unknown; disabled: boolean; onChange: (v: string[]) => void; onBlur: (v: string[]) => void }) {
  const parts = splitBlanks(q.prompt);
  const current = Array.isArray(value) ? (value as unknown[]).map((v) => (typeof v === 'string' ? v : '')) : [];
  const at = (i: number, v: string) => {
    const next = Array.from({ length: q.blanks }, (_, k) => current[k] ?? '');
    next[i] = v;
    return next;
  };
  return (
    <p className="mt-2 text-sm leading-[2.4]">
      {parts.map((text, i) => (
        <span key={i}>
          {text}
          {i < parts.length - 1 && i < q.blanks && (
            <input
              type="text"
              aria-label={`Blank ${i + 1}`}
              value={current[i] ?? ''}
              disabled={disabled}
              onChange={(e) => onChange(at(i, e.target.value))}
              onBlur={(e) => onBlur(at(i, e.target.value))}
              className="mx-1 inline-block w-36 rounded-[var(--radius-sm)] border-b-2 border-[var(--brand)] bg-[var(--surface-2)] px-2 py-0.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-soft)] disabled:opacity-70"
              maxLength={200}
            />
          )}
        </span>
      ))}
    </p>
  );
}

/** Each left item picks its partner from the shuffled right column. */
function MatchInput({ q, value, disabled, onChange }: { q: PaperQuestion; value: unknown; disabled: boolean; onChange: (v: number[]) => void }) {
  const m = q.match!;
  const current = Array.isArray(value) ? (value as unknown[]).map((v) => (typeof v === 'number' ? v : -1)) : m.left.map(() => -1);
  return (
    <ul className="space-y-2">
      {m.left.map((left, i) => (
        <li key={i} className="grid items-center gap-2 sm:grid-cols-[1fr_auto_1fr]">
          <span className="text-sm">{left}</span>
          <span className="faint hidden text-center sm:block">→</span>
          <select
            aria-label={`Match for ${left}`}
            value={current[i] ?? -1}
            disabled={disabled}
            onChange={(e) => {
              const next = [...current];
              while (next.length < m.left.length) next.push(-1);
              next[i] = Number(e.target.value);
              onChange(next);
            }}
            className="w-full rounded-[var(--radius-sm)] border bg-[var(--surface)] px-2 py-1.5 text-sm"
          >
            <option value={-1}>Choose</option>
            {m.right.map((r) => (
              <option key={r.index} value={r.index}>
                {r.label}
              </option>
            ))}
          </select>
        </li>
      ))}
    </ul>
  );
}

/** Items with up and down buttons. Keyboard and touch both work; a drag is not required. */
function OrderInput({ q, value, disabled, onChange }: { q: PaperQuestion; value: unknown; disabled: boolean; onChange: (v: number[]) => void }) {
  const items = q.ordering!;
  const order = Array.isArray(value) && (value as unknown[]).length === items.length ? (value as number[]) : items.map((it) => it.index);
  const label = (index: number) => items.find((it) => it.index === index)?.label ?? '?';
  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length) return;
    const next = [...order];
    [next[from], next[to]] = [next[to], next[from]];
    onChange(next);
  };
  return (
    <ol className="space-y-1.5">
      {order.map((index, pos) => (
        <li key={index} className="flex items-center gap-2 rounded-[var(--radius-sm)] border bg-[var(--surface)] px-3 py-2 text-sm">
          <span className="t-small faint w-5 tabular-nums">{pos + 1}.</span>
          <span className="flex-1">{label(index)}</span>
          <button type="button" aria-label="Move up" disabled={disabled || pos === 0} onClick={() => move(pos, pos - 1)} className="rounded border px-2 py-0.5 text-xs disabled:opacity-40">
            ↑
          </button>
          <button type="button" aria-label="Move down" disabled={disabled || pos === order.length - 1} onClick={() => move(pos, pos + 1)} className="rounded border px-2 py-0.5 text-xs disabled:opacity-40">
            ↓
          </button>
        </li>
      ))}
    </ol>
  );
}

function UploadInput({ attemptId, q, value, disabled, onSaved }: { attemptId: string; q: PaperQuestion; value: unknown; disabled: boolean; onSaved: (v: unknown) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const current = uploadedAnswer(value);
  return (
    <div className="space-y-2">
      {current && (
        <p className="t-small">
          Attached: <span className="font-medium">{current.fileName}</span>
        </p>
      )}
      <input
        type="file"
        disabled={disabled || busy}
        className="block text-sm"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setBusy(true);
          setErr(undefined);
          const fd = new FormData();
          fd.append('file', file);
          const res = await uploadAnswer(attemptId, q.id, fd);
          setBusy(false);
          if (res.error) setErr(res.error);
          else onSaved(res.answer);
        }}
      />
      <p className="t-small faint">{busy ? 'Uploading...' : 'Up to 25 MB. Choosing another file replaces this one.'}</p>
      {err && <p className="t-small text-[var(--bad)]">{err}</p>}
    </div>
  );
}

/** Record in the browser, play it back, hand it in. */
function SpeakingInput({ attemptId, q, value, disabled, onSaved }: { attemptId: string; q: PaperQuestion; value: unknown; disabled: boolean; onSaved: (v: unknown) => void }) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [preview, setPreview] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);
  const current = uploadedAnswer(value);

  const supported = typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

  const stop = useCallback(() => {
    recorder.current?.stop();
    if (ticker.current) clearInterval(ticker.current);
  }, []);

  useEffect(() => () => stop(), [stop]);

  async function start() {
    setErr(undefined);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      const startedAt = Date.now();
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const took = Math.round((Date.now() - startedAt) / 1000);
        const blob = new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' });
        if (blob.size === 0) return;
        setPreview(URL.createObjectURL(blob));
        setBusy(true);
        const fd = new FormData();
        const ext = (rec.mimeType || 'audio/webm').includes('mp4') ? 'm4a' : 'webm';
        fd.append('file', new File([blob], `answer.${ext}`, { type: rec.mimeType || 'audio/webm' }));
        fd.append('durationSeconds', String(took));
        const res = await uploadAnswer(attemptId, q.id, fd);
        setBusy(false);
        if (res.error) setErr(res.error);
        else onSaved(res.answer);
      };
      recorder.current = rec;
      rec.start();
      setRecording(true);
      setSeconds(0);
      ticker.current = setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= SPEAKING_MAX_SECONDS) stop();
          return s + 1;
        });
      }, 1000);
    } catch {
      setErr('The microphone could not be opened. Allow it in the browser and try again.');
    }
  }

  if (!supported) return <p className="t-small text-[var(--warn)]">This browser cannot record audio. Use Chrome, Edge, Firefox or Safari 14 or later.</p>;

  return (
    <div className="space-y-2">
      {(preview || current) && !recording && (
        <audio controls src={preview ?? `/api/assets/${current!.assetId}`} className="w-full" />
      )}
      <div className="flex flex-wrap items-center gap-3">
        {recording ? (
          <Button type="button" variant="danger" onClick={stop}>
            Stop · {clock(seconds)}
          </Button>
        ) : (
          <Button type="button" variant={current ? 'secondary' : 'primary'} disabled={disabled || busy} onClick={() => void start()}>
            {busy ? 'Uploading...' : current ? 'Record again' : 'Start recording'}
          </Button>
        )}
        <p className="t-small faint">Up to five minutes. Recording again replaces the earlier take.</p>
      </div>
      {err && <p className="t-small text-[var(--bad)]">{err}</p>}
    </div>
  );
}

function clock(seconds: number): string {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}
