'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { savePosition } from '@/server/notes';

type VimeoPlayer = {
  on: (event: string, cb: (data: { seconds?: number; duration?: number }) => void) => void;
  setCurrentTime: (s: number) => Promise<number>;
  getCurrentTime: () => Promise<number>;
  getDuration: () => Promise<number>;
  destroy: () => Promise<void>;
};

/**
 * A lesson on Vimeo, in Vimeo's player with everything but play, the
 * progress bar, volume and full screen switched off (the address arrives
 * locked from the server). Right-click is refused on the frame's border as
 * well as inside it, the viewer's watermark sits on top, and the place is
 * remembered the way the page's own player remembers it: every fifteen
 * seconds, on pause, at the end and when the tab is hidden.
 *
 * With a watermark the page owns full screen (Vimeo's own full screen would
 * leave the mark behind), so a button here takes the frame and the mark
 * full screen together.
 */
export function VimeoFrame({
  embedUrl,
  title,
  materialId,
  startAt,
  durationSeconds,
  onTimeUpdate,
  watermark,
}: {
  embedUrl: string;
  title: string;
  materialId: string;
  startAt: number;
  durationSeconds: number | null;
  onTimeUpdate?: (seconds: number) => void;
  watermark?: string | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const player = useRef<VimeoPlayer | null>(null);
  const position = useRef(0);
  const length = useRef(durationSeconds ?? 0);
  const lastSaved = useRef(0);
  const [corner, setCorner] = useState(0);
  const [resumed, setResumed] = useState(startAt < 5);
  const [canFullscreen, setCanFullscreen] = useState(false);

  const persist = useCallback(
    (force = false) => {
      const at = Math.floor(position.current);
      if (!force && Math.abs(at - lastSaved.current) < 15) return;
      if (at <= 0 && !force) return;
      lastSaved.current = at;
      void savePosition(materialId, at, length.current || undefined);
    },
    [materialId],
  );

  useEffect(() => {
    let cancelled = false;
    let instance: VimeoPlayer | null = null;
    import('@vimeo/player').then(({ default: Player }) => {
      if (cancelled || !frame.current) return;
      instance = new Player(frame.current) as unknown as VimeoPlayer;
      player.current = instance;
      instance.on('loaded', () => {
        if (startAt > 5) {
          void instance!.getDuration().then((d) => {
            length.current = d || length.current;
            if (!d || startAt < d - 5) void instance!.setCurrentTime(startAt).catch(() => {});
          });
        }
      });
      instance.on('timeupdate', (e) => {
        position.current = e.seconds ?? position.current;
        if (e.duration) length.current = e.duration;
        onTimeUpdate?.(position.current);
        persist();
      });
      instance.on('pause', () => persist(true));
      instance.on('ended', () => persist(true));
    });
    return () => {
      cancelled = true;
      persist(true);
      void instance?.destroy().catch(() => {});
    };
    // The player is made once per address; the callbacks read refs.
  }, [embedUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') persist(true);
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [persist]);

  useEffect(() => {
    if (!watermark) return;
    setCanFullscreen(Boolean(document.fullscreenEnabled));
    const timer = setInterval(() => setCorner((c) => (c + 1) % 4), 30_000);
    return () => clearInterval(timer);
  }, [watermark]);

  return (
    <div className="space-y-2">
      <div
        ref={box}
        className="relative aspect-video w-full overflow-hidden rounded-[var(--radius)] border bg-black"
        onContextMenu={(e) => e.preventDefault()}
      >
        <iframe
          ref={frame}
          src={embedUrl}
          title={title}
          className="absolute inset-0 h-full w-full"
          allow="autoplay; fullscreen; encrypted-media"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen={!watermark}
        />

        {watermark && (
          <span
            aria-hidden
            className="pointer-events-none absolute select-none text-[0.6875rem] font-medium text-white/45 transition-all duration-1000"
            style={{
              top: corner < 2 ? '8%' : undefined,
              bottom: corner >= 2 ? '16%' : undefined,
              left: corner === 0 || corner === 3 ? '6%' : undefined,
              right: corner === 1 || corner === 2 ? '6%' : undefined,
              textShadow: '0 1px 3px rgba(0,0,0,0.8)',
            }}
          >
            {watermark}
          </span>
        )}

        {watermark && canFullscreen && (
          <button
            type="button"
            aria-label="Full screen"
            className="absolute right-2 top-2 rounded-[var(--radius-sm)] bg-black/55 px-2 py-1 text-xs font-medium text-white hover:bg-black/75"
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen();
              else void box.current?.requestFullscreen();
            }}
          >
            Full screen
          </button>
        )}
      </div>

      {startAt > 5 && !resumed && (
        <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-sm)] border bg-[var(--surface-2)] px-3 py-2">
          <span className="t-small muted">Picking up from {Math.floor(startAt / 60)}:{String(Math.floor(startAt % 60)).padStart(2, '0')}.</span>
          <button
            type="button"
            className="t-small underline"
            onClick={() => {
              void player.current?.setCurrentTime(0);
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
