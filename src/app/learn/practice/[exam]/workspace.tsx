'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { newPracticeTask, submitPractice } from '@/server/practice';
import { wordCount } from '@/lib/ai-evaluation';
import { Button, Card, FormError, Textarea } from '@/components/ui';

/**
 * One sitting: get a task (or bring your own), answer it against a clock,
 * send it to the examiner. Writing is a textarea with a live word count.
 * Speaking uses the browser's own speech recognition where it exists
 * (Chrome, Edge, Safari) and falls back to a typed transcript where it
 * does not, because a learner on an old Firefox should still be able to
 * practise.
 */

interface PresetView {
  key: string;
  kind: 'WRITING' | 'SPEAKING';
  label: string;
  length: string;
  language: 'en' | 'de';
  criteria: string[];
}

/* The bits of the Web Speech API this file uses; the DOM lib does not ship them. */
interface RecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<RecognitionResultLike> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => RecognitionLike;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function Workspace({ preset, ready, left }: { preset: PresetView; ready: boolean; left: number }) {
  const router = useRouter();
  const [task, setTask] = useState<{ title: string; task: string } | null>(null);
  const [ownTask, setOwnTask] = useState(false);
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState<string>();
  const [gettingTask, startGetTask] = useTransition();
  const [marking, startMark] = useTransition();

  // The clock starts when the task is on screen and stops on submit.
  const [seconds, setSeconds] = useState(0);
  const startedAt = useRef<number | null>(null);
  useEffect(() => {
    if (!task || marking) return;
    startedAt.current ??= Date.now();
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - (startedAt.current ?? Date.now())) / 1000)), 500);
    return () => clearInterval(id);
  }, [task, marking]);

  // Speaking: the recogniser writes into the answer as the learner talks.
  const [listening, setListening] = useState(false);
  const [canListen, setCanListen] = useState<boolean | null>(null);
  const recogniser = useRef<RecognitionLike | null>(null);
  const finalText = useRef('');
  useEffect(() => {
    setCanListen(preset.kind === 'SPEAKING' ? Boolean(recognitionCtor()) : null);
  }, [preset.kind]);

  function startListening() {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = preset.language === 'de' ? 'de-DE' : 'en-IN';
    r.continuous = true;
    r.interimResults = true;
    finalText.current = answer ? answer.trim() + ' ' : '';
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const res = e.results[i];
        if (res.isFinal) finalText.current += res[0].transcript.trim() + ' ';
        else interim += res[0].transcript;
      }
      setAnswer((finalText.current + interim).trim());
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed') setError('The browser did not allow the microphone. Allow it in the address bar and try again.');
      else if (e.error !== 'no-speech' && e.error !== 'aborted') setError(`Speech recognition stopped: ${e.error}.`);
    };
    r.onend = () => {
      // Chrome ends a session after a pause; keep going until the learner stops.
      if (recogniser.current === r) {
        try {
          r.start();
        } catch {
          setListening(false);
        }
      }
    };
    recogniser.current = r;
    setError(undefined);
    r.start();
    setListening(true);
  }

  function stopListening() {
    const r = recogniser.current;
    recogniser.current = null;
    r?.stop();
    setListening(false);
  }

  useEffect(() => () => recogniser.current?.stop(), []);

  function getTask() {
    setError(undefined);
    startGetTask(async () => {
      const res = await newPracticeTask(preset.key);
      if (res.ok) {
        setTask({ title: res.title, task: res.task });
        setOwnTask(false);
        startedAt.current = null;
        setSeconds(0);
      } else setError(res.error);
    });
  }

  function submit() {
    if (!task) return;
    stopListening();
    setError(undefined);
    startMark(async () => {
      const res = await submitPractice({
        examKey: preset.key,
        task: task.task,
        response: answer,
        durationSeconds: startedAt.current ? Math.round((Date.now() - startedAt.current) / 1000) : null,
      });
      if (res.ok) router.push(`/learn/practice/attempts/${res.attemptId}`);
      else setError(res.error);
    });
  }

  const words = wordCount(answer);

  if (!ready) {
    return (
      <Card className="border-dashed">
        <p className="font-semibold">The examiner is not connected yet</p>
        <p className="t-small muted mt-1">The academy needs to add its Anthropic key under Integrations. Nothing to do on your side.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* The task */}
      <Card>
        {task ? (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <p className="t-eyebrow" style={{ color: 'var(--brand)' }}>
                {ownTask ? 'Your task' : task.title}
              </p>
              <span className="t-small faint tabular-nums">{clock(seconds)}</span>
            </div>
            {ownTask ? (
              <Textarea
                className="mt-2"
                rows={4}
                value={task.task}
                onChange={(e) => setTask({ title: 'Your task', task: e.target.value })}
                placeholder="Paste the task from your book or class here."
                maxLength={4000}
              />
            ) : (
              <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed">{task.task}</p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="ghost" size="sm" onClick={getTask} disabled={gettingTask || marking || left <= 0}>
                {gettingTask ? 'Writing a task...' : 'Different task'}
              </Button>
              {!ownTask && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setOwnTask(true);
                    setTask({ title: 'Your task', task: '' });
                  }}
                  disabled={marking}
                >
                  Use my own task
                </Button>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm leading-relaxed">
              The examiner writes a fresh task in the exam&rsquo;s own style, or you can bring one from your book.
              {preset.kind === 'WRITING' ? ` Aim for ${preset.length}.` : ' You will have a cue card and two follow-up questions.'}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={getTask} disabled={gettingTask || left <= 0}>
                {gettingTask ? 'Writing a task...' : 'Give me a task'}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setOwnTask(true);
                  setTask({ title: 'Your task', task: '' });
                }}
              >
                Use my own task
              </Button>
            </div>
            {left <= 0 && <p className="t-small text-[var(--warn)]">You have used today&rsquo;s attempts. They come back over the next day.</p>}
          </div>
        )}
      </Card>

      {/* The answer */}
      {task && (
        <Card>
          {preset.kind === 'SPEAKING' ? (
            <>
              <div className="flex flex-wrap items-center gap-3">
                {canListen ? (
                  listening ? (
                    <Button variant="danger" onClick={stopListening} disabled={marking}>
                      <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-white" aria-hidden />
                      Stop
                    </Button>
                  ) : (
                    <Button onClick={startListening} disabled={marking}>
                      {answer ? 'Continue speaking' : 'Start speaking'}
                    </Button>
                  )
                ) : canListen === false ? (
                  <p className="t-small text-[var(--warn)]">
                    This browser cannot transcribe speech. Use Chrome, Edge or Safari, or type what you would say below.
                  </p>
                ) : null}
                <span className="t-small faint tabular-nums">{words} words</span>
              </div>
              <Textarea
                className="mt-3"
                rows={8}
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder={canListen ? 'Your words appear here as you speak. You can tidy the transcript before sending it.' : 'Type your answer as you would say it.'}
                disabled={marking}
                maxLength={12000}
              />
              <p className="t-small faint mt-2">
                The examiner marks the transcript, so pronunciation is estimated from what the recogniser heard. Speak clearly and at a natural pace.
              </p>
            </>
          ) : (
            <>
              <Textarea
                rows={14}
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder={`Write your answer here. ${preset.length[0].toUpperCase()}${preset.length.slice(1)}.`}
                disabled={marking}
                maxLength={12000}
                spellCheck={false}
              />
              <p className="t-small faint mt-2 tabular-nums">
                {words} words · marked on {preset.criteria.join(', ').toLowerCase()}
              </p>
            </>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3 border-t pt-4">
            <Button onClick={submit} disabled={marking || !answer.trim() || left <= 0}>
              {marking ? 'The examiner is reading...' : 'Send to the examiner'}
            </Button>
            <span className="t-small faint">{left} attempt{left === 1 ? '' : 's'} left today. Marking takes under a minute.</span>
          </div>
          <div className="mt-3">
            <FormError message={error} />
          </div>
        </Card>
      )}

      {!task && <FormError message={error} />}
    </div>
  );
}
