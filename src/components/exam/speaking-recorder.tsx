'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Recording one speaking task. The recording stops by itself at the task's
 * time, is sent the moment it stops, and can be taken again while the part
 * is open (the new take replaces the old). What is marked is the recording
 * itself, not a transcript the browser made of it.
 */

interface Props {
  sittingId: string;
  blockId: string;
  maxSeconds: number;
  hasRecording: boolean;
  disabled: boolean;
  language: 'de' | 'en';
  onSaved: () => void;
}

const W = {
  de: {
    start: 'Aufnahme starten',
    stop: 'Aufnahme beenden',
    again: 'Neu aufnehmen',
    saving: 'Wird gespeichert…',
    saved: 'Aufnahme gespeichert.',
    earlier: 'Eine Aufnahme ist gespeichert. Eine neue ersetzt sie.',
    noMic: 'Kein Mikrofon: erlauben Sie den Zugriff in der Adressleiste und laden Sie die Seite neu.',
    failed: 'Die Aufnahme kam nicht an. Versuchen Sie es noch einmal.',
    loud: 'Sprechen Sie laut und deutlich, in normalem Tempo und mit etwas Abstand zum Mikrofon.',
  },
  en: {
    start: 'Start recording',
    stop: 'Stop recording',
    again: 'Record again',
    saving: 'Saving…',
    saved: 'Recording saved.',
    earlier: 'A recording is saved. A new one replaces it.',
    noMic: 'No microphone: allow access in the address bar and reload the page.',
    failed: 'The recording did not arrive. Try once more.',
    loud: 'Speak clearly, at a normal pace, a little away from the microphone.',
  },
};

const mm = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function SpeakingRecorder(props: Props) {
  const w = W[props.language];
  const [state, setState] = useState<'idle' | 'recording' | 'saving' | 'saved' | 'error'>(props.hasRecording ? 'saved' : 'idle');
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [message, setMessage] = useState<string | null>(props.hasRecording ? w.earlier : null);
  const [local, setLocal] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const meter = useRef<number | null>(null);
  const startedAt = useRef(0);

  useEffect(
    () => () => {
      if (rec.current?.state === 'recording') rec.current.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
      if (timer.current) clearInterval(timer.current);
      if (meter.current) cancelAnimationFrame(meter.current);
    },
    [],
  );

  async function begin() {
    setMessage(null);
    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      setState('error');
      setMessage(w.noMic);
      return;
    }
    stream.current = media;
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t));
    const r = new MediaRecorder(media, type ? { mimeType: type } : undefined);
    const chunks: Blob[] = [];
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    r.onstop = () => upload(new Blob(chunks, { type: r.mimeType || 'audio/webm' }));
    rec.current = r;
    r.start(1000);
    startedAt.current = Date.now();
    setElapsed(0);
    setState('recording');
    timer.current = setInterval(() => {
      const s = (Date.now() - startedAt.current) / 1000;
      setElapsed(s);
      if (s >= props.maxSeconds) end();
    }, 250);
    try {
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(media);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      const data = new Uint8Array(an.frequencyBinCount);
      const tick = () => {
        an.getByteTimeDomainData(data);
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
        setLevel(Math.min(1, peak / 64));
        meter.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      /* No meter is no loss. */
    }
  }

  function end() {
    if (timer.current) clearInterval(timer.current);
    if (meter.current) cancelAnimationFrame(meter.current);
    setLevel(0);
    if (rec.current?.state === 'recording') rec.current.stop();
    stream.current?.getTracks().forEach((t) => t.stop());
  }

  async function upload(blob: Blob) {
    setState('saving');
    const seconds = Math.round((Date.now() - startedAt.current) / 1000);
    if (local) URL.revokeObjectURL(local);
    setLocal(URL.createObjectURL(blob));
    const form = new FormData();
    form.set('task', props.blockId);
    form.set('seconds', String(seconds));
    form.set('file', new File([blob], `speaking.${blob.type.includes('mp4') ? 'm4a' : 'webm'}`, { type: blob.type }));
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`/api/tests/${props.sittingId}/recording`, { method: 'POST', body: form });
        const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (res.ok && body.ok) {
          setState('saved');
          setMessage(w.saved);
          props.onSaved();
          return;
        }
        if (res.status < 500) {
          setState('error');
          setMessage(body.error ?? w.failed);
          return;
        }
      } catch {
        /* the network; try again */
      }
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
    setState('error');
    setMessage(w.failed);
  }

  const recording = state === 'recording';
  return (
    <div className="exam-recorder">
      <p className="t-small muted">{w.loud}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {recording ? (
          <button type="button" className="exam-recbtn on" onClick={end}>
            <span className="dot" aria-hidden />
            {w.stop}
          </button>
        ) : (
          <button type="button" className="exam-recbtn" onClick={begin} disabled={props.disabled || state === 'saving'}>
            <span className="dot" aria-hidden />
            {state === 'saved' || state === 'error' ? w.again : w.start}
          </button>
        )}
        <div className="exam-meter" aria-hidden>
          <i style={{ width: `${Math.round(level * 100)}%` }} />
        </div>
        <span className="font-mono text-sm" aria-live="off">
          {mm(elapsed)} / {mm(props.maxSeconds)}
        </span>
      </div>
      {state === 'saving' && <p className="t-small mt-2">{w.saving}</p>}
      {message && <p className={`t-small mt-2 ${state === 'error' ? 'text-[var(--bad)]' : 'text-[var(--ok)]'}`}>{message}</p>}
      {local && !recording && <audio className="mt-2 w-full" controls src={local} />}
    </div>
  );
}
