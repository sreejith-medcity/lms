'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { askTutor } from '@/server/tutor';
import type { Citation } from '@/lib/tutor';
import { TUTOR_QUESTION_MAX } from '@/lib/tutor';
import { stamp } from '@/components/media-player';

export interface TutorMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations: Citation[];
}

/**
 * A tutor that only knows the course. The thread is per course, so a
 * question asked in lesson 4 is still here in lesson 7. A citation that
 * points into this lesson seeks the player; one that points elsewhere is
 * named so the learner can go there.
 */
export function TutorTab({
  materialId,
  lessonTitle,
  history,
  left,
  ready,
  qaHref,
  onSeek,
}: {
  materialId: string;
  lessonTitle: string;
  history: TutorMessage[];
  /** Questions left today, or null when the tutor is off. */
  left: number | null;
  /** The academy has the model connected. */
  ready: boolean;
  qaHref: string;
  onSeek?: (seconds: number) => void;
}) {
  const [messages, setMessages] = useState<TutorMessage[]>(history);
  const [remaining, setRemaining] = useState(left);
  const [question, setQuestion] = useState('');
  const [problem, setProblem] = useState<string>();
  const [pending, start] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages.length, pending]);

  function send() {
    const q = question.trim();
    if (!q || pending) return;
    setProblem(undefined);
    const mine: TutorMessage = { id: `u-${Date.now()}`, role: 'user', content: q, citations: [] };
    setMessages((m) => [...m, mine]);
    setQuestion('');
    start(async () => {
      const fd = new FormData();
      fd.set('materialId', materialId);
      fd.set('question', q);
      const r = await askTutor({}, fd);
      if (r.error || !r.answer) {
        setProblem(r.error ?? 'No answer came back.');
        setMessages((m) => m.filter((x) => x.id !== mine.id));
        setQuestion(q);
        return;
      }
      setMessages((m) => [...m, { id: `a-${Date.now()}`, role: 'assistant', content: r.answer!, citations: r.citations ?? [] }]);
      if (typeof r.left === 'number') setRemaining(r.left);
    });
  }

  if (!ready) {
    return (
      <p className="t-small faint max-w-prose">
        The tutor is not switched on for this academy yet. Your trainer answers questions in the{' '}
        <Link href={qaHref} className="underline" style={{ color: 'var(--brand)' }}>
          Q&amp;A tab
        </Link>
        .
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="t-small faint max-w-prose">
        Ask about anything taught in this course. The tutor answers only from the lessons and says where; for anything
        else, your trainer is in the{' '}
        <Link href={qaHref} className="underline" style={{ color: 'var(--brand)' }}>
          Q&amp;A tab
        </Link>
        .
      </p>

      {messages.length > 0 && (
        <ol className="space-y-3">
          {messages.map((m) => (
            <li key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className="max-w-[85%] rounded-[var(--radius)] px-4 py-3 text-sm leading-relaxed"
                style={
                  m.role === 'user'
                    ? { background: 'var(--brand)', color: 'var(--brand-ink)' }
                    : { background: 'var(--surface)', border: '1px solid var(--line)' }
                }
              >
                <p className="whitespace-pre-wrap">{m.content}</p>
                {m.role === 'assistant' && m.citations.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {m.citations.map((c) => {
                      const here = c.title === lessonTitle && c.seconds !== null && onSeek;
                      return (
                        <li key={`${c.title}-${c.seconds}`}>
                          {here ? (
                            <button
                              type="button"
                              onClick={() => onSeek?.(c.seconds!)}
                              className="t-small rounded-full border px-2.5 py-0.5 hover:border-[var(--brand)]"
                            >
                              {stamp(c.seconds!)} in this lesson
                            </button>
                          ) : (
                            <span className="t-small rounded-full border px-2.5 py-0.5 faint">
                              {c.title}
                              {c.seconds !== null ? ` at ${stamp(c.seconds)}` : ''}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </li>
          ))}
          {pending && (
            <li className="flex justify-start">
              <div className="rounded-[var(--radius)] border bg-[var(--surface)] px-4 py-3 text-sm faint">Reading the lessons…</div>
            </li>
          )}
        </ol>
      )}
      <div ref={endRef} />

      {problem && (
        <p className="t-small" style={{ color: 'var(--bad)' }}>
          {problem}
        </p>
      )}

      <div className="flex gap-2">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={2}
          maxLength={TUTOR_QUESTION_MAX}
          placeholder={remaining === 0 ? 'Back tomorrow.' : 'Ask the tutor about this course'}
          disabled={pending || remaining === 0}
          className="min-w-0 flex-1 rounded-[var(--radius-sm)] border bg-[var(--surface)] px-3 py-2 text-sm"
          aria-label="Your question"
        />
        <button
          type="button"
          onClick={send}
          disabled={pending || !question.trim() || remaining === 0}
          className="h-10 shrink-0 self-end rounded-[var(--radius-sm)] px-4 text-sm font-semibold text-[var(--brand-ink)] disabled:opacity-50"
          style={{ background: 'var(--brand)' }}
        >
          Ask
        </button>
      </div>
      {remaining !== null && remaining > 0 && remaining <= 5 && (
        <p className="t-small faint">{remaining} more today.</p>
      )}
    </div>
  );
}
