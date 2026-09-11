'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';

/**
 * The player's frame: the lesson on the left, the curriculum on the right,
 * the way people have learned to expect from every course platform.
 *
 * The sidebar can be tucked away for a wide video and comes back with one
 * press; the choice is remembered per browser. On a phone it is a sheet.
 */
export function PlayerShell({
  productId,
  courseTitle,
  completed,
  total,
  stage,
  rail,
}: {
  productId: string;
  courseTitle: string;
  completed: number;
  total: number;
  stage: ReactNode;
  rail: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const [sheet, setSheet] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('mlms_player_rail');
      if (saved === 'closed') setOpen(false);
    } catch {
      /* storage blocked: default open */
    }
  }, []);

  const toggle = () => {
    setOpen((v) => {
      try {
        window.localStorage.setItem('mlms_player_rail', v ? 'closed' : 'open');
      } catch {
        /* ignore */
      }
      return !v;
    });
  };

  const percent = total ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="flex min-h-[calc(100dvh-3.5rem)] flex-col">
      {/* The course bar: where you are, how far you are, and the sidebar switch. */}
      <div className="flex items-center gap-3 border-b bg-[var(--surface)] px-4 py-2 sm:px-5">
        <Link href={`/learn/${productId}`} className="min-w-0 flex-1 truncate text-sm font-semibold hover:underline">
          {courseTitle}
        </Link>
        <div className="hidden items-center gap-2 sm:flex" aria-label={`${percent}% complete`}>
          <ProgressRing value={percent} />
          <span className="t-small faint whitespace-nowrap tabular-nums">
            {completed} / {total} done
          </span>
        </div>
        <button
          type="button"
          onClick={() => setSheet(true)}
          className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border px-2.5 text-sm font-medium lg:hidden"
        >
          Contents
        </button>
        <button
          type="button"
          onClick={toggle}
          aria-pressed={open}
          className="hidden h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border px-2.5 text-sm font-medium hover:bg-[var(--surface-2)] lg:inline-flex"
        >
          {open ? 'Hide course content' : 'Course content'}
        </button>
      </div>

      <div className="flex flex-1 items-stretch">
        <div className="min-w-0 flex-1">{stage}</div>

        {open && (
          <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-[24rem] shrink-0 flex-col border-l bg-[var(--surface)] lg:flex">
            {rail}
          </aside>
        )}
      </div>

      {sheet && (
        <div className="fixed inset-0 z-50 flex lg:hidden" role="dialog" aria-modal="true" aria-label="Course contents">
          <button aria-label="Close contents" className="flex-1 bg-black/40" onClick={() => setSheet(false)} />
          <div className="flex w-[85vw] max-w-sm flex-col bg-[var(--surface)]" onClick={(e) => {
            // A lesson picked from the sheet closes it.
            if ((e.target as HTMLElement).closest('a')) setSheet(false);
          }}>
            {rail}
          </div>
        </div>
      )}
    </div>
  );
}

function ProgressRing({ value }: { value: number }) {
  const r = 9;
  const c = 2 * Math.PI * r;
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r={r} fill="none" stroke="var(--line-strong)" strokeWidth="3" />
      <circle
        cx="12"
        cy="12"
        r={r}
        fill="none"
        stroke="var(--brand)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={`${(c * value) / 100} ${c}`}
        transform="rotate(-90 12 12)"
      />
    </svg>
  );
}
