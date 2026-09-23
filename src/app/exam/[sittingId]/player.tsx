'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { safeHtml } from '@/lib/exams/html';
import { ObjectiveBlock, exclusive, type Answers, type Block } from '@/components/exam/blocks';
import { ListeningPlayer } from '@/components/exam/listening-player';
import { SpeakingTask, WritingTask } from '@/components/exam/production';
import {
  claimPlayAction,
  endPreparationAction,
  finishSectionAction,
  guardAction,
  handInAction,
  saveAnswerAction,
  saveChoiceAction,
  saveNotesAction,
  saveWritingAction,
  startSectionAction,
} from '@/server/tests';

/**
 * The exam, in the browser. It draws what the server drew and reports what
 * the candidate does; the server keeps the clocks and decides what is still
 * taken. Answers are sent as they change; the header says whether the last
 * one arrived.
 */

type Phase = 'prep' | 'exam';
type Clock = { startedAt: string; phase: Phase; deadline: string };

export interface PlayerSection {
  id: string;
  label: string;
  short: string;
  title: string;
  minutes: number;
  preparationMinutes?: number;
  intro: string;
  plain: string;
  notice: string;
}

export interface PlayerProps {
  sittingId: string;
  formatName: string;
  language: 'de' | 'en';
  mode: 'exam' | 'practice';
  sections: PlayerSection[];
  paper: (Block & { sectionId: string; part: string; instructions: string; plain: string; fileCount?: number })[];
  answers: Answers;
  clocks: Record<string, Clock>;
  done: string[];
  plays: Record<string, number>;
  notes: Record<string, string>;
  writing: Record<string, string>;
  recorded: string[];
  serverNow: number;
}

const W = {
  de: {
    part: 'Teil',
    start: 'Diesen Teil beginnen',
    minutes: 'Minuten',
    prepMinutes: 'Minuten Vorbereitung, danach',
    finish: 'Diesen Teil abschließen',
    finishQ: 'Diesen Teil abschließen? Danach können Sie nicht mehr zurück.',
    unanswered: 'Noch offen',
    next: 'Weiter',
    prev: 'Zurück',
    left: 'Restzeit',
    prep: 'Vorbereitung',
    endPrep: 'Vorbereitung beenden und mit der Aufnahme beginnen',
    notes: 'Ihre Notizen (Stichwörter genügen, ablesen sollten Sie nicht)',
    handIn: 'Abgeben',
    handInQ: 'Den Test jetzt abgeben?',
    handing: 'Wird abgegeben…',
    allDone: 'Alle Teile sind abgeschlossen.',
    allDoneText: 'Geben Sie den Test jetzt ab. Lesen und Hören sind sofort ausgewertet; Schreiben und Sprechen folgen in wenigen Minuten.',
    saved: 'Gespeichert',
    saving: 'Speichert…',
    offline: 'Nicht gespeichert: Verbindung prüfen',
    timeUp: 'Die Zeit für diesen Teil ist um. Ihre Antworten sind gespeichert.',
    translate: 'Übersetzungsprogramm erkannt',
    translateText: 'Diese Seite darf während der Prüfung nicht übersetzt werden. Schalten Sie die Übersetzung im Browser ab und laden Sie die Seite neu.',
    reload: 'Seite neu laden',
    copy: 'Kopieren ist während der Prüfung gesperrt.',
    practice: 'Übungsmodus: ohne Zeitbegrenzung, Sie können frei wechseln.',
    closed: 'abgeschlossen',
  },
  en: {
    part: 'Part',
    start: 'Start this part',
    minutes: 'minutes',
    prepMinutes: 'minutes of preparation, then',
    finish: 'Finish this part',
    finishQ: 'Finish this part? You cannot come back to it.',
    unanswered: 'Not answered',
    next: 'Next',
    prev: 'Back',
    left: 'Time left',
    prep: 'Preparation',
    endPrep: 'End preparation and start recording',
    notes: 'Your notes (keywords are enough; do not read out)',
    handIn: 'Hand in',
    handInQ: 'Hand the test in now?',
    handing: 'Handing in…',
    allDone: 'Every part is finished.',
    allDoneText: 'Hand the test in now. Reading and listening are counted at once; writing and speaking follow in a few minutes.',
    saved: 'Saved',
    saving: 'Saving…',
    offline: 'Not saved: check the connection',
    timeUp: 'Time is up for this part. Your answers are saved.',
    translate: 'Translation detected',
    translateText: 'This page may not be translated during the exam. Turn translation off in the browser and reload the page.',
    reload: 'Reload the page',
    copy: 'Copying is off during the exam.',
    practice: 'Practice mode: no clocks, move freely.',
    closed: 'finished',
  },
};

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const html = (s: unknown) => ({ __html: safeHtml(s) });
const GRACE_MS = 20_000;

export function ExamPlayer(props: PlayerProps) {
  const router = useRouter();
  const w = W[props.language];
  const practice = props.mode === 'practice';
  const offset = useRef(props.serverNow - Date.now());
  const now = () => Date.now() + offset.current;

  const [answers, setAnswers] = useState<Answers>(props.answers);
  const [clocks, setClocks] = useState<Record<string, Clock>>(props.clocks);
  const [done, setDone] = useState<string[]>(props.done);
  const [played, setPlayed] = useState<Record<string, number>>(props.plays);
  const [notes, setNotes] = useState<Record<string, string>>(props.notes);
  const [recorded, setRecorded] = useState<Set<string>>(new Set(props.recorded));
  const [flags, setFlags] = useState<Set<number>>(new Set());
  const [blockIndex, setBlockIndex] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [notice, setNotice] = useState<string | null>(null);
  const [halted, setHalted] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef(0);
  const typedTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  const order = props.sections.map((s) => s.id);
  const isDone = useCallback(
    (id: string) => {
      if (done.includes(id)) return true;
      const c = clocks[id];
      return !practice && Boolean(c) && c.phase === 'exam' && now() > new Date(c.deadline).getTime() + GRACE_MS;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [done, clocks, practice, tick],
  );
  const current = practice ? (picked ?? order.find((id) => !done.includes(id)) ?? order[0]) : (order.find((id) => !isDone(id)) ?? null);
  const section = props.sections.find((s) => s.id === current) ?? null;
  const clock = current ? clocks[current] : undefined;
  const blocks = useMemo(() => props.paper.filter((p) => p.sectionId === current), [props.paper, current]);
  const block = blocks[Math.min(blockIndex, Math.max(0, blocks.length - 1))];
  const left = clock ? Math.max(0, Math.floor((new Date(clock.deadline).getTime() - now()) / 1000)) : null;

  /* The clock. */
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 500);
    return () => clearInterval(t);
  }, []);

  const timingOut = useRef<string | null>(null);
  useEffect(() => {
    if (practice || !current || !clock || left === null || left > 0) return;
    const key = `${current}:${clock.phase}`;
    if (timingOut.current === key) return;
    timingOut.current = key;
    (async () => {
      if (clock.phase === 'prep') {
        const r = await endPreparationAction(props.sittingId, current);
        if (r.ok && r.clock) setClocks((c) => ({ ...c, [current]: r.clock as Clock }));
      } else {
        setNotice(w.timeUp);
        await finish(current, true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left, current, clock?.phase]);

  /* The guard: no translation, no copying out of the paper, leaving the window counted. */
  useEffect(() => {
    if (practice) return;
    const root = document.documentElement;
    root.setAttribute('translate', 'no');
    root.classList.add('notranslate');
    const seen = () =>
      root.classList.contains('translated-ltr') ||
      root.classList.contains('translated-rtl') ||
      Boolean(document.querySelector('font[_msttexthash], font[style*="vertical-align"], .goog-te-banner-frame, #goog-gt-tt'));
    const halt = () => {
      if (!seen()) return;
      setHalted((was) => {
        if (!was) void guardAction(props.sittingId, 'translate');
        return true;
      });
    };
    const obs = new MutationObserver(halt);
    obs.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    const poll = setInterval(halt, 1500);
    const onCopy = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) return;
      e.preventDefault();
      setNotice(w.copy);
      void guardAction(props.sittingId, 'copy');
    };
    const onContext = (e: MouseEvent) => e.preventDefault();
    const onHide = () => {
      if (document.hidden) void guardAction(props.sittingId, 'leave');
    };
    const onLeave = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCopy);
    document.addEventListener('contextmenu', onContext);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('beforeunload', onLeave);
    return () => {
      obs.disconnect();
      clearInterval(poll);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCopy);
      document.removeEventListener('contextmenu', onContext);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('beforeunload', onLeave);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [practice]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(t);
  }, [notice]);

  async function track<T>(p: Promise<{ ok: boolean; error?: string } & T>): Promise<({ ok: boolean; error?: string } & T) | null> {
    pending.current++;
    setSaveState('saving');
    try {
      const r = await p;
      pending.current--;
      if (!r.ok) {
        setSaveState('failed');
        if (r.error) setNotice(r.error);
      } else if (pending.current === 0) setSaveState('saved');
      return r;
    } catch {
      pending.current--;
      setSaveState('failed');
      return null;
    }
  }

  function answer(n: number, value: string | null, typed?: boolean) {
    const b = props.paper.find((p) => (p.items ?? []).some((it) => it.n === n));
    const updates: [number, string | null][] = [[n, value]];
    /* A heading, an advert or a word belongs to one question: choosing it here takes it from the other. */
    if (b && value && value !== 'x' && exclusive(b)) {
      for (const it of b.items ?? []) if (it.n !== n && answers[String(it.n)] === value) updates.push([it.n, null]);
    }
    setAnswers((a) => {
      const next = { ...a };
      for (const [k, v] of updates) next[String(k)] = v;
      return next;
    });
    for (const [k, v] of updates) {
      if (typed && k === n) {
        clearTimeout(typedTimers.current[k]);
        typedTimers.current[k] = setTimeout(() => void track(saveAnswerAction(props.sittingId, k, v)), 800);
      } else {
        clearTimeout(typedTimers.current[k]);
        void track(saveAnswerAction(props.sittingId, k, v));
      }
    }
  }

  function choose(blockId: string, index: number) {
    setAnswers((a) => ({ ...a, [`choice:${blockId}`]: String(index) }));
    void track(saveChoiceAction(props.sittingId, blockId, index));
  }

  async function startSection(id: string) {
    setBusy(true);
    const r = await track(startSectionAction(props.sittingId, id));
    setBusy(false);
    if (r?.ok && 'clock' in r && r.clock) setClocks((c) => ({ ...c, [id]: r.clock as Clock }));
    setBlockIndex(0);
    window.scrollTo(0, 0);
  }

  async function endPrep(id: string) {
    const r = await track(endPreparationAction(props.sittingId, id));
    if (r?.ok && 'clock' in r && r.clock) setClocks((c) => ({ ...c, [id]: r.clock as Clock }));
    setBlockIndex(0);
    window.scrollTo(0, 0);
  }

  async function finish(id: string, byClock = false) {
    if (!byClock && !practice && !window.confirm(w.finishQ)) return;
    const r = await track(finishSectionAction(props.sittingId, id));
    setDone((d) => (d.includes(id) ? d : [...d, id]));
    setBlockIndex(0);
    setPicked(null);
    window.scrollTo(0, 0);
    const last = order.every((x) => x === id || isDone(x) || done.includes(x));
    if (!practice && (r && 'allDone' in r ? r.allDone : last)) await handIn(true);
  }

  async function handIn(auto = false) {
    if (!auto && !window.confirm(w.handInQ)) return;
    setBusy(true);
    for (const t of Object.values(typedTimers.current)) clearTimeout(t);
    const r = await track(handInAction(props.sittingId));
    if (r?.ok) {
      window.onbeforeunload = null;
      router.replace(`/exam/${props.sittingId}/result`);
    } else setBusy(false);
  }

  const unansweredIn = (ids: string[]) =>
    props.paper
      .filter((p) => ids.includes(p.sectionId))
      .flatMap((p) => p.items ?? [])
      .filter((it) => answers[String(it.n)] == null || String(answers[String(it.n)]).trim() === '').length;

  if (halted) {
    return (
      <div className="exam-blockout" role="alertdialog">
        <div>
          <p className="exam-eyebrow text-[var(--bad)]">{w.translate}</p>
          <h2 className="mt-2 text-xl font-semibold">{w.translate}</h2>
          <p className="mt-3">{w.translateText}</p>
          <button type="button" className="exam-btn primary mt-5" onClick={() => location.reload()}>
            {w.reload}
          </button>
        </div>
      </div>
    );
  }

  const status: 'waiting' | 'prep' | 'open' | 'done' = !section ? 'done' : practice ? 'open' : !clock ? 'waiting' : clock.phase === 'prep' ? 'prep' : 'open';
  const warn = left !== null && left < 300;
  const crit = left !== null && left < 60;

  return (
    <div className="exam-shell" translate="no">
      <header className="exam-top">
        <div className="min-w-0">
          <p className="exam-eyebrow">{props.formatName}</p>
          <p className="truncate font-semibold">{section ? section.title : w.allDone}</p>
        </div>
        <nav className="exam-steps" aria-label={w.part}>
          {props.sections.map((s, i) => {
            const finished = isDone(s.id);
            const here = s.id === current;
            return practice ? (
              <button key={s.id} type="button" className={`exam-step ${here ? 'here' : ''} ${finished ? 'done' : ''}`} onClick={() => { setPicked(s.id); setBlockIndex(0); }}>
                {i + 1}. {s.short}
              </button>
            ) : (
              <span key={s.id} className={`exam-step ${here ? 'here' : ''} ${finished ? 'done' : ''}`} title={finished ? w.closed : undefined}>
                {i + 1}. {s.short}
              </span>
            );
          })}
        </nav>
        <div className="flex items-center gap-4">
          <span className={`exam-save ${saveState}`} aria-live="polite">
            {saveState === 'saving' ? w.saving : saveState === 'failed' ? w.offline : saveState === 'saved' ? w.saved : ''}
          </span>
          {!practice && clock && (
            <div className={`exam-clock ${crit ? 'crit' : warn ? 'warn' : ''}`} role="timer">
              <small>{clock.phase === 'prep' ? w.prep : w.left}</small>
              <b>{mmss(left ?? 0)}</b>
            </div>
          )}
          {practice && (
            <button type="button" className="exam-btn primary" disabled={busy} onClick={() => handIn()}>
              {busy ? w.handing : w.handIn}
            </button>
          )}
        </div>
      </header>

      {notice && <div className="exam-toast" role="status">{notice}</div>}
      {practice && <p className="exam-practice">{w.practice}</p>}

      <main className="exam-main">
        {status === 'done' && (
          <div className="exam-intro">
            <h1>{w.allDone}</h1>
            <p>{w.allDoneText}</p>
            <button type="button" className="exam-btn primary mt-6" disabled={busy} onClick={() => handIn(true)}>
              {busy ? w.handing : w.handIn}
            </button>
          </div>
        )}

        {status === 'waiting' && section && (
          <div className="exam-intro">
            <p className="exam-eyebrow">
              {w.part} {order.indexOf(section.id) + 1} / {order.length}
            </p>
            <h1>{section.title}</h1>
            <p className="lede">
              {section.preparationMinutes && blocks.some((b) => b.layout === 'speak') ? `${section.preparationMinutes} ${w.prepMinutes} ` : ''}
              {section.minutes} {w.minutes}
            </p>
            <p dangerouslySetInnerHTML={html(section.intro)} />
            <p className="plain" dangerouslySetInnerHTML={html(section.plain)} />
            <p className="notice" dangerouslySetInnerHTML={html(section.notice)} />
            <button type="button" className="exam-btn primary mt-6" disabled={busy} onClick={() => startSection(section.id)}>
              {w.start}
            </button>
          </div>
        )}

        {status === 'prep' && section && (
          <div>
            <h1 className="exam-h1">
              {section.title}: {w.prep}
            </h1>
            {blocks
              .filter((b) => b.layout === 'speak')
              .map((b) => (
                <section key={b.id} className="exam-stage">
                  <div className="exam-stage-head">
                    <p className="exam-eyebrow">{b.part}</p>
                    <h2>{b.title}</h2>
                  </div>
                  <div className="exam-instructions" dangerouslySetInnerHTML={html(b.instructions)} />
                  <SpeakingTask
                    sittingId={props.sittingId}
                    block={b}
                    choice={answers[`choice:${b.id}`] != null ? Number(answers[`choice:${b.id}`]) : null}
                    onChoice={(i) => choose(b.id, i)}
                    phase="prep"
                    practice={practice}
                    hasRecording={recorded.has(b.id)}
                    disabled={false}
                    onRecorded={() => undefined}
                    language={props.language}
                  />
                </section>
              ))}
            <NotesBox sittingId={props.sittingId} sectionId={section.id} value={notes[section.id] ?? ''} onChange={(v) => setNotes((n) => ({ ...n, [section.id]: v }))} label={w.notes} />
            <button type="button" className="exam-btn primary mt-6" onClick={() => endPrep(section.id)}>
              {w.endPrep}
            </button>
          </div>
        )}

        {status === 'open' && section && block && (
          <div>
            {blocks.length > 1 && (
              <div className="exam-blocktabs" role="tablist">
                {blocks.map((b, i) => {
                  const open = (b.items ?? []).filter((it) => answers[String(it.n)] == null || String(answers[String(it.n)]).trim() === '').length;
                  return (
                    <button key={b.id} type="button" role="tab" aria-selected={b.id === block.id} className={`exam-blocktab ${b.id === block.id ? 'here' : ''}`} onClick={() => { setBlockIndex(i); window.scrollTo(0, 0); }}>
                      {b.part}
                      {open > 0 && <span className="open">{open}</span>}
                    </button>
                  );
                })}
              </div>
            )}
            <section className="exam-stage" key={block.id}>
              <div className="exam-stage-head">
                <div>
                  <p className="exam-eyebrow">{block.part}</p>
                  <h2>{block.title}</h2>
                </div>
                {(block.items ?? []).length > 0 && (
                  <span className="t-small muted">
                    {block.items![0].no}–{block.items![block.items!.length - 1].no}
                  </span>
                )}
              </div>
              <div className="exam-instructions">
                <span dangerouslySetInnerHTML={html(block.instructions)} />
                {block.plain && (
                  <span className="plain">
                    <b>{props.language === 'de' ? 'Kurz gesagt:' : 'In short:'}</b> <span dangerouslySetInnerHTML={html(block.plain)} />
                  </span>
                )}
              </div>
              {block.layout === 'write' || block.layout === 'mitteilung' ? (
                <WritingTask
                  block={block}
                  text={props.writing[block.id] ?? ''}
                  choice={answers[`choice:${block.id}`] != null ? Number(answers[`choice:${block.id}`]) : null}
                  onChoice={(i) => choose(block.id, i)}
                  save={async (text) => Boolean((await track(saveWritingAction(props.sittingId, block.id, text)))?.ok)}
                  disabled={false}
                  language={props.language}
                />
              ) : block.layout === 'speak' ? (
                <SpeakingTask
                  sittingId={props.sittingId}
                  block={block}
                  choice={answers[`choice:${block.id}`] != null ? Number(answers[`choice:${block.id}`]) : null}
                  onChoice={(i) => choose(block.id, i)}
                  phase="exam"
                  practice={practice}
                  hasRecording={recorded.has(block.id)}
                  disabled={false}
                  onRecorded={() => setRecorded((r) => new Set(r).add(block.id))}
                  language={props.language}
                />
              ) : (
                <ObjectiveBlock
                  block={block}
                  answers={answers}
                  onAnswer={answer}
                  disabled={false}
                  flags={flags}
                  toggleFlag={(n) => setFlags((f) => { const x = new Set(f); if (x.has(n)) x.delete(n); else x.add(n); return x; })}
                  language={props.language}
                  player={
                    block.layout.startsWith('audio') ? (
                      <ListeningPlayer
                        key={block.id}
                        sittingId={props.sittingId}
                        blockId={block.id}
                        script={(block.script as { sp: string; t: string }[]) ?? []}
                        textCount={block.textCount as number | undefined}
                        readSeconds={block.readSeconds as number | undefined}
                        pauseSeconds={block.pauseSeconds as number | undefined}
                        plays={Number(block.plays) || 1}
                        fileCount={block.fileCount ?? 0}
                        practice={practice}
                        alreadyPlayed={(played[block.id] ?? 0) > 0}
                        claim={async () => {
                          const r = await claimPlayAction(props.sittingId, block.id);
                          if (r.ok && r.allowed) setPlayed((p) => ({ ...p, [block.id]: (p[block.id] ?? 0) + 1 }));
                          return r.ok && r.allowed;
                        }}
                        language={props.language}
                      />
                    ) : undefined
                  }
                />
              )}
            </section>
            <footer className="exam-foot">
              <button type="button" className="exam-btn" disabled={blockIndex === 0} onClick={() => { setBlockIndex((i) => Math.max(0, i - 1)); window.scrollTo(0, 0); }}>
                {w.prev}
              </button>
              <span className="t-small muted">
                {unansweredIn([section.id]) > 0 ? `${w.unanswered}: ${unansweredIn([section.id])}` : ''}
              </span>
              {blockIndex < blocks.length - 1 ? (
                <button type="button" className="exam-btn primary" onClick={() => { setBlockIndex((i) => i + 1); window.scrollTo(0, 0); }}>
                  {w.next}
                </button>
              ) : (
                <button type="button" className="exam-btn primary" disabled={busy} onClick={() => finish(section.id)}>
                  {w.finish}
                </button>
              )}
            </footer>
          </div>
        )}
      </main>
    </div>
  );
}

function NotesBox({ sittingId, sectionId, value, onChange, label }: { sittingId: string; sectionId: string; value: string; onChange: (v: string) => void; label: string }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  return (
    <label className="mt-6 block">
      <span className="exam-eyebrow">{label}</span>
      <textarea
        className="exam-compose notes"
        value={value}
        spellCheck={false}
        onChange={(e) => {
          const v = e.target.value.slice(0, 4000);
          onChange(v);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => void saveNotesAction(sittingId, sectionId, v), 1000);
        }}
      />
    </label>
  );
}
