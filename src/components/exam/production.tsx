'use client';

import { useEffect, useRef, useState } from 'react';
import { safeHtml } from '@/lib/exams/html';
import { SpeakingRecorder } from '@/components/exam/speaking-recorder';
import type { Block } from '@/components/exam/blocks';

/**
 * Writing and speaking. What each is marked on is shown before the
 * candidate starts, in the exam's own words and points, and comes back on
 * the result with the marks against it.
 */

const html = (s: unknown) => ({ __html: safeHtml(s) });
type Criterion = { name: string; describes?: string; max: number };
type Lead = { k: string; t: string };
type Theme = { titel?: string; brief?: string; leit?: Lead[] };
type SpeakTheme = { title: string; short: string; task: string; card: string[]; phrases: string[] };

const W = {
  de: {
    marked: 'Wie dieser Teil bewertet wird',
    points: 'Punkte',
    after: 'Nach der Abgabe steht hier zu jeder Zeile Ihre Punktzahl und ein Satz dazu.',
    lead: 'Leitpunkte',
    choose: 'Wählen Sie ein Thema',
    chooseFirst: 'Sobald Sie ein Thema gewählt haben, erscheinen die Aufgabenstellung und das Schreibfeld.',
    chooseSpeak: 'Sobald Sie ein Thema gewählt haben, erscheinen die Stichwortkarte und die Aufnahme. Die Wahl lässt sich danach noch ändern.',
    yourText: 'Ihr Text',
    words: 'Wörter',
    target: 'Empfehlung',
    saving: 'wird gespeichert…',
    saved: 'gespeichert',
    notSaved: 'nicht gespeichert, bitte kurz warten',
    card: 'Stichwortkarte',
    phrases: 'Redemittel anzeigen (nur zum Üben, in der Prüfung gibt es sie nicht)',
    watch: 'Worauf die Prüfenden achten',
    prep: 'Vorbereitung: lesen Sie die Aufgabe und machen Sie Notizen. Aufgenommen wird danach.',
  },
  en: {
    marked: 'How this part is marked',
    points: 'points',
    after: 'After you hand in, each line shows your mark and a comment.',
    lead: 'Points to cover',
    choose: 'Choose a topic',
    chooseFirst: 'Choose a topic and the task and the writing box appear.',
    chooseSpeak: 'Choose a topic and the task card and the recorder appear. You can still change it.',
    yourText: 'Your text',
    words: 'words',
    target: 'Aim for',
    saving: 'saving…',
    saved: 'saved',
    notSaved: 'not saved yet, a moment please',
    card: 'Task card',
    phrases: 'Useful phrases (practice only; there are none in the exam)',
    watch: 'What the examiners listen for',
    prep: 'Preparation: read the task and make notes. You record afterwards.',
  },
};

export function Criteria({ criteria, language }: { criteria: Criterion[]; language: 'de' | 'en' }) {
  const w = W[language];
  if (!criteria.length) return null;
  const total = criteria.reduce((a, c) => a + c.max, 0);
  return (
    <details className="exam-criteria">
      <summary>
        {w.marked} <span className="max">{String(total).replace('.', ',')} {w.points}</span>
      </summary>
      <ul>
        {criteria.map((c) => (
          <li key={c.name}>
            <div>
              <b>{c.name}</b>
              {c.describes && <p>{c.describes}</p>}
            </div>
            <span className="pts">{String(c.max).replace('.', ',')}</span>
          </li>
        ))}
      </ul>
      <p className="t-small faint">{w.after}</p>
    </details>
  );
}

const countWords = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0);

export function WritingTask(props: {
  block: Block;
  text: string;
  choice: number | null;
  onChoice: (i: number) => void;
  save: (text: string) => Promise<boolean>;
  disabled: boolean;
  language: 'de' | 'en';
}) {
  const w = W[props.language];
  const b = props.block;
  const themes = Array.isArray(b.themen) ? (b.themen as Theme[]) : null;
  const theme: Theme | null = themes ? (props.choice != null ? (themes[props.choice] ?? null) : null) : (b as Theme);
  const words = (b.words as { min: number; max: number } | undefined) ?? (themes ? { min: 180, max: 230 } : { min: 130, max: 180 });
  const [text, setText] = useState(props.text);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(text);

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        void props.save(latest.current);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  function change(v: string) {
    setText(v);
    latest.current = v;
    setStatus('saving');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      timer.current = null;
      setStatus((await props.save(v)) ? 'saved' : 'failed');
    }, 1200);
  }

  const n = countWords(text);
  return (
    <div className="exam-write">
      {themes && (
        <>
          <p className="exam-eyebrow">{w.choose}</p>
          <div className="exam-themes">
            {themes.map((t, i) => (
              <button key={i} type="button" disabled={props.disabled} className={`exam-theme ${props.choice === i ? 'sel' : ''}`} onClick={() => props.onChoice(i)}>
                <span className="k">{i === 0 ? 'A' : 'B'}</span>
                <span dangerouslySetInnerHTML={html(t.titel)} />
              </button>
            ))}
          </div>
        </>
      )}
      {theme ? (
        <>
          <p className="exam-brief" dangerouslySetInnerHTML={html(theme.brief)} />
          <p className="exam-eyebrow">{w.lead}</p>
          <ul className="exam-lead">
            {(theme.leit ?? []).map((l) => (
              <li key={l.k}>
                <span className="k">{l.k}</span>
                <span dangerouslySetInnerHTML={html(l.t)} />
              </li>
            ))}
          </ul>
          <label className="exam-eyebrow mt-5 block" htmlFor={`compose-${b.id}`}>
            {(b.fieldLabel as string) || w.yourText}
          </label>
          <textarea
            id={`compose-${b.id}`}
            className="exam-compose"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            value={text}
            disabled={props.disabled}
            onChange={(e) => change(e.target.value)}
            placeholder={props.language === 'de' ? 'Sehr geehrte Damen und Herren,\n\n…' : 'Dear …,\n\n…'}
          />
          <div className="exam-wmeta">
            <span>
              {w.words}: <b>{n}</b>
            </span>
            <span className={`exam-chip ${n >= words.min && n <= words.max ? 'ok' : ''}`}>
              {w.target}: {words.min}–{words.max} {w.words}
            </span>
            <span className="ml-auto" aria-live="polite">
              {status === 'saving' ? w.saving : status === 'saved' ? w.saved : status === 'failed' ? w.notSaved : ''}
            </span>
          </div>
        </>
      ) : (
        <p className="t-small muted mt-4">{w.chooseFirst}</p>
      )}
      <Criteria criteria={(b.criteria as Criterion[]) ?? []} language={props.language} />
    </div>
  );
}

export function SpeakingTask(props: {
  sittingId: string;
  block: Block;
  choice: number | null;
  onChoice: (i: number) => void;
  phase: 'prep' | 'exam';
  practice: boolean;
  hasRecording: boolean;
  disabled: boolean;
  onRecorded: () => void;
  language: 'de' | 'en';
}) {
  const w = W[props.language];
  const b = props.block;
  const themes = Array.isArray(b.themes) ? (b.themes as SpeakTheme[]) : null;
  const theme = themes && props.choice != null ? (themes[props.choice] ?? null) : null;
  const task = theme ? theme.task : (b.auftrag as string | undefined);
  const card = theme ? theme.card : ((b.karte as string[] | undefined) ?? []);
  const phrases = theme ? theme.phrases : ((b.redemittel as string[] | undefined) ?? []);
  const tips = (b.tipps as string[] | undefined) ?? [];
  const needsChoice = Boolean(themes) && !theme;

  return (
    <div className="exam-speak">
      {themes && (
        <>
          <p className="exam-eyebrow">{w.choose}</p>
          <div className="exam-themes seven">
            {themes.map((t, i) => (
              <button key={i} type="button" disabled={props.disabled} className={`exam-theme ${props.choice === i ? 'sel' : ''}`} onClick={() => props.onChoice(i)}>
                <span className="k">{i + 1}</span>
                <span>{t.short || t.title}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {needsChoice ? (
        <p className="t-small muted mt-4">{w.chooseSpeak}</p>
      ) : (
        <>
          {task && <p className="exam-brief" dangerouslySetInnerHTML={html(task)} />}
          {card.length > 0 && (
            <div className="exam-card">
              <div className="head">{w.card}</div>
              <ul>
                {card.map((c, i) => (
                  <li key={i} dangerouslySetInnerHTML={html(c)} />
                ))}
              </ul>
            </div>
          )}
          {props.practice && phrases.length > 0 && (
            <details className="exam-phrases">
              <summary>{w.phrases}</summary>
              <div>
                {phrases.map((p, i) => (
                  <span key={i} dangerouslySetInnerHTML={html(p)} />
                ))}
              </div>
            </details>
          )}
          {props.phase === 'prep' ? (
            <p className="exam-note">{w.prep}</p>
          ) : (
            <SpeakingRecorder
              sittingId={props.sittingId}
              blockId={b.id}
              maxSeconds={Number(b.recordSeconds) || 180}
              hasRecording={props.hasRecording}
              disabled={props.disabled}
              language={props.language}
              onSaved={props.onRecorded}
            />
          )}
          {tips.length > 0 && (
            <div className="exam-card tips">
              <div className="head">{w.watch}</div>
              <ul>
                {tips.map((t, i) => (
                  <li key={i} dangerouslySetInnerHTML={html(t)} />
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      <Criteria criteria={(b.criteria as Criterion[]) ?? []} language={props.language} />
    </div>
  );
}
