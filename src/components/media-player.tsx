'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { savePosition } from '@/server/notes';

/**
 * Video and audio that remember where you were.
 *
 * The position is written every fifteen seconds while playing, on pause, and
 * when the tab is hidden, which is the case that actually matters: people close
 * a laptop mid-lesson far more often than they press pause. Seeking is left to
 * the browser's own controls; the range requests behind them are answered by the
 * media route, so scrubbing does not re-download the file.
 */
export function MediaPlayer({
  kind,
  src,
  materialId,
  startAt,
  durationSeconds,
  onTimeUpdate,
  watermark,
  blockContextMenu = false,
}: {
  kind: 'video' | 'audio';
  src: string;
  materialId: string;
  startAt: number;
  durationSeconds: number | null;
  onTimeUpdate?: (seconds: number) => void;
  /** Who is watching, overlaid on the video when the academy asks for it. */
  watermark?: string | null;
  blockContextMenu?: boolean;
}) {
  const ref = useRef<HTMLVideoElement | HTMLAudioElement>(null);
  const lastSaved = useRef(0);
  const [resumed, setResumed] = useState(startAt < 5);
  const [corner, setCorner] = useState(0);

  // The mark moves every half minute. A fixed corner is cropped out in one cut;
  // one that wanders has to be tracked through the whole recording, which is
  // more trouble than re-recording it.
  useEffect(() => {
    if (!watermark) return;
    const timer = setInterval(() => setCorner((c) => (c + 1) % 4), 30_000);
    return () => clearInterval(timer);
  }, [watermark]);

  const persist = useCallback(
    (force = false) => {
      const el = ref.current;
      if (!el) return;
      const at = Math.floor(el.currentTime);
      if (!force && Math.abs(at - lastSaved.current) < 15) return;
      lastSaved.current = at;
      void savePosition(materialId, at, durationSeconds ?? (Math.floor(el.duration) || undefined));
    },
    [durationSeconds, materialId],
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onHide = () => {
      if (document.visibilityState === 'hidden') persist(true);
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', () => persist(true));

    return () => {
      document.removeEventListener('visibilitychange', onHide);
      persist(true);
    };
  }, [persist]);

  const common = {
    ref: ref as never,
    src,
    controls: true,
    controlsList: 'nodownload',
    onLoadedMetadata: () => {
      const el = ref.current;
      if (el && startAt > 5 && startAt < (el.duration || Infinity) - 5) {
        el.currentTime = startAt;
      }
    },
    onTimeUpdate: () => {
      const el = ref.current;
      if (!el) return;
      onTimeUpdate?.(el.currentTime);
      persist();
    },
    onPause: () => persist(true),
    onEnded: () => persist(true),
  };

  return (
    <div className="space-y-2">
      {kind === 'video' ? (
        <div
          className="relative overflow-hidden rounded-[var(--radius)] border bg-black"
          onContextMenu={blockContextMenu ? (e) => e.preventDefault() : undefined}
        >
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video {...common} playsInline className="aspect-video w-full" />

          {watermark && (
            <span
              aria-hidden
              className="pointer-events-none absolute select-none text-[0.6875rem] font-medium text-white/45 transition-all duration-1000"
              style={{
                top: corner < 2 ? '8%' : undefined,
                bottom: corner >= 2 ? '12%' : undefined,
                left: corner === 0 || corner === 3 ? '6%' : undefined,
                right: corner === 1 || corner === 2 ? '6%' : undefined,
                textShadow: '0 1px 3px rgba(0,0,0,0.8)',
              }}
            >
              {watermark}
            </span>
          )}
        </div>
      ) : (
        <audio {...common} className="w-full" />
      )}

      {startAt > 5 && !resumed && (
        <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-sm)] border bg-[var(--surface-2)] px-3 py-2">
          <span className="t-small muted">Picking up from {stamp(startAt)}.</span>
          <button
            type="button"
            className="t-small underline"
            onClick={() => {
              const el = ref.current;
              if (el) el.currentTime = 0;
              setResumed(true);
            }}
          >
            Start from the beginning
          </button>
        </div>
      )}
    </div>
  );
}

export function stamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
