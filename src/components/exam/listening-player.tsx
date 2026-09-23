'use client';

import { useEffect, useRef, useState } from 'react';
import { listeningParts, type ScriptLine } from '@/lib/exams/listening';

/**
 * A listening block, played the way the exam plays it: the spoken
 * instruction, then reading time with a countdown, then the texts with a
 * pause between them, and the whole run once more where the exam gives a
 * second hearing. A started run cannot be paused or skipped. In exam mode
 * the block is heard as often as the exam allows and no more (the server
 * keeps the count, so a reload does not buy another hearing); in practice
 * mode as often as the candidate likes.
 *
 * Recorded files are used when the block has one for every piece; otherwise
 * the browser's German voice reads the script. A file that stalls for
 * twelve seconds hands over to the voice rather than leaving silence.
 */

interface Props {
  sittingId: string;
  blockId: string;
  script: ScriptLine[];
  textCount?: number;
  readSeconds?: number;
  pauseSeconds?: number;
  plays: number;
  fileCount: number;
  practice: boolean;
  alreadyPlayed: boolean;
  /** Ask the server for this block's hearing; false when it has been used. */
  claim: () => Promise<boolean>;
  language: 'de' | 'en';
}

type Stage = 'ready' | 'instruction' | 'reading' | 'playing' | 'pause' | 'again' | 'done' | 'used' | 'blocked';

const WORDS = {
  de: {
    play: 'Hörtext abspielen',
    readyOnce: 'Sie hören den Text einmal.',
    readyTwice: 'Sie hören den Text zweimal.',
    practice: 'Übungsmodus: beliebig oft.',
    instruction: 'Anweisung',
    reading: 'Lesen Sie jetzt die Aufgaben. Der Hörtext beginnt in',
    playing: 'Wiedergabe läuft',
    pause: 'Der nächste Text beginnt in',
    again: 'Der Text beginnt noch einmal in',
    done: 'Wiedergabe beendet.',
    used: 'Diese Wiedergabe ist verbraucht.',
    blocked: 'Der Ton wurde angehalten. Tippen Sie auf Wiedergabe, um weiterzuhören. Das zählt nicht noch einmal.',
    first: 'Lesen Sie zuerst die Aufgaben. Die Wiedergabe startet erst, wenn Sie darauf drücken.',
    seconds: 'Sekunden',
    voice: 'Kein Tondokument für diesen Teil: der Text wird vom Browser vorgelesen.',
  },
  en: {
    play: 'Play the recording',
    readyOnce: 'You will hear the recording once.',
    readyTwice: 'You will hear the recording twice.',
    practice: 'Practice mode: as often as you like.',
    instruction: 'Instructions',
    reading: 'Read the questions now. The recording starts in',
    playing: 'Playing',
    pause: 'The next recording starts in',
    again: 'The recording starts again in',
    done: 'Finished.',
    used: 'This recording has been played.',
    blocked: 'The sound was stopped. Tap play to carry on; it does not count again.',
    first: 'Read the questions first. The recording starts only when you press play.',
    seconds: 'seconds',
    voice: 'No recording for this part: the browser reads the text aloud.',
  },
};

export function ListeningPlayer(props: Props) {
  const w = WORDS[props.language];
  const parts = listeningParts(props.script, props.textCount);
  const useFiles = props.fileCount > 0 && props.fileCount === parts.length;
  const hasInstruction = parts[0]?.kind === 'instruction';
  const firstText = hasInstruction ? 1 : 0;

  const [stage, setStage] = useState<Stage>(props.alreadyPlayed && !props.practice ? 'used' : 'ready');
  const [count, setCount] = useState(0);
  const [progress, setProgress] = useState(0);
  const [run, setRun] = useState(0);
  const token = useRef(0);
  const audio = useRef<HTMLAudioElement | null>(null);
  const resume = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      token.current++;
      audio.current?.pause();
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    },
    [],
  );

  function element(): HTMLAudioElement {
    if (!audio.current) {
      const a = new Audio();
      a.preload = 'auto';
      a.setAttribute('playsinline', '');
      audio.current = a;
    }
    return audio.current;
  }

  /* A phone lets sound play only from a touch; one muted play from the button press unlocks the element for the whole run. */
  function unlock() {
    const a = element();
    if (a.dataset.free) return;
    a.dataset.free = '1';
    a.muted = true;
    a.play()
      .then(() => {
        a.pause();
        a.muted = false;
      })
      .catch(() => {
        a.muted = false;
      });
  }

  const wait = (seconds: number, label: Stage, mine: number) =>
    new Promise<void>((resolve) => {
      setStage(label);
      let left = Math.max(0, Math.round(seconds));
      setCount(left);
      const t = setInterval(() => {
        if (mine !== token.current) {
          clearInterval(t);
          return;
        }
        left--;
        setCount(Math.max(0, left));
        if (left <= 0) {
          clearInterval(t);
          resolve();
        }
      }, 1000);
    });

  function speak(lines: ScriptLine[], mine: number): Promise<void> {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window)) return resolve();
      const synth = window.speechSynthesis;
      const voices = synth.getVoices().filter((v) => v.lang.toLowerCase().startsWith(props.language));
      const voice = voices.sort((a, b) => Number(/google/i.test(b.name)) - Number(/google/i.test(a.name)))[0] ?? null;
      /* Long utterances are cut off by some browsers, so a sentence at a time. */
      const pieces = lines.flatMap((l) => String(l.t).replace(/<[^>]+>/g, ' ').split(/(?<=[.!?])\s+/)).filter((x) => x.trim());
      let i = 0;
      const next = () => {
        if (mine !== token.current) return resolve();
        if (i >= pieces.length) return resolve();
        const u = new SpeechSynthesisUtterance(pieces[i++]);
        u.lang = props.language === 'de' ? 'de-DE' : 'en-GB';
        if (voice) u.voice = voice;
        u.rate = 0.95;
        u.onend = () => setTimeout(next, 250);
        u.onerror = () => setTimeout(next, 250);
        synth.speak(u);
      };
      next();
    });
  }

  function playFile(index: number, mine: number): Promise<'ok' | 'voice' | 'blocked'> {
    return new Promise((resolve) => {
      const a = element();
      let dog: ReturnType<typeof setTimeout> | null = null;
      const watch = () => {
        if (dog) clearTimeout(dog);
        dog = setTimeout(() => {
          a.pause();
          resolve('voice');
        }, 12_000);
      };
      a.ontimeupdate = () => {
        watch();
        if (a.duration) setProgress(((index - (hasInstruction ? 1 : 0) + a.currentTime / a.duration) / Math.max(1, parts.length - (hasInstruction ? 1 : 0))) * 100);
      };
      a.onended = () => {
        if (dog) clearTimeout(dog);
        resolve('ok');
      };
      a.onerror = () => {
        if (dog) clearTimeout(dog);
        resolve('voice');
      };
      a.src = `/api/tests/${props.sittingId}/audio/${props.blockId}/${index}`;
      watch();
      a.play().catch(() => {
        if (dog) clearTimeout(dog);
        if (mine !== token.current) return resolve('ok');
        resolve('blocked');
      });
    });
  }

  async function piece(index: number, mine: number): Promise<void> {
    if (useFiles) {
      const r = await playFile(index, mine);
      if (r === 'ok') return;
      if (r === 'blocked') {
        /* The phone stopped the sound mid-run: ask for a tap, and carry on from this piece. */
        setStage('blocked');
        await new Promise<void>((res) => {
          resume.current = res;
        });
        setStage('playing');
        return piece(index, mine);
      }
    }
    await speak(parts[index].lines, mine);
  }

  async function start() {
    if (stage === 'blocked' && resume.current) {
      const r = resume.current;
      resume.current = null;
      r();
      return;
    }
    if (!['ready', 'done'].includes(stage)) return;
    if (stage === 'done' && !props.practice) return;
    unlock();
    const mine = ++token.current;
    const ok = await props.claim();
    if (!ok) {
      setStage('used');
      return;
    }
    setProgress(0);
    if (hasInstruction) {
      setStage('instruction');
      await piece(0, mine);
      if (mine !== token.current) return;
    }
    await wait(props.readSeconds ?? 15, 'reading', mine);
    const runs = props.practice ? 1 : Math.max(1, props.plays || 1);
    for (let r = 0; r < runs; r++) {
      setRun(r + 1);
      if (r > 0) await wait(Math.max(3, Math.min(8, props.pauseSeconds ?? 5)), 'again', mine);
      for (let i = firstText; i < parts.length; i++) {
        if (mine !== token.current) return;
        if (i > firstText) await wait(props.pauseSeconds ?? 6, 'pause', mine);
        setStage('playing');
        await piece(i, mine);
      }
    }
    if (mine !== token.current) return;
    setProgress(100);
    setStage(props.practice ? 'done' : 'used');
  }

  const busy = ['instruction', 'reading', 'playing', 'pause', 'again'].includes(stage);
  const canPress = stage === 'ready' || stage === 'blocked' || (stage === 'done' && props.practice);
  const line =
    stage === 'ready'
      ? w.first
      : stage === 'instruction'
        ? w.instruction
        : stage === 'reading'
          ? `${w.reading} ${count} ${w.seconds}`
          : stage === 'pause'
            ? `${w.pause} ${count} ${w.seconds}`
            : stage === 'again'
              ? `${w.again} ${count} ${w.seconds}`
              : stage === 'playing'
                ? w.playing
                : stage === 'blocked'
                  ? w.blocked
                  : stage === 'used'
                    ? w.used
                    : w.done;

  return (
    <div className="exam-player" role="group" aria-label={w.play}>
      <div className="flex items-center gap-4">
        <button type="button" className="exam-playbtn" onClick={start} disabled={!canPress} aria-label={w.play}>
          {busy ? <span className="exam-eq" aria-hidden /> : '▶'}
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{props.practice ? w.practice : props.plays > 1 ? w.readyTwice : w.readyOnce}</p>
          <p className="t-small muted" aria-live="polite">
            {line}
            {busy && !props.practice && props.plays > 1 && run > 0 ? ` (${run}/${props.plays})` : ''}
          </p>
        </div>
      </div>
      <div className="exam-wave" aria-hidden>
        <i style={{ width: `${Math.min(100, progress)}%` }} />
      </div>
      {!useFiles && <p className="t-small faint mt-2">{w.voice}</p>}
    </div>
  );
}
