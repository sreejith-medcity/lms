'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A row that scrolls sideways, with arrows where there is a mouse.
 *
 * The cards are rendered by the server and passed in as children: the rail
 * only owns the scrolling. On a phone the arrows are hidden and a thumb does
 * the work, which is what a phone is for.
 */
export function Rail({ children, ariaLabel }: { children: ReactNode; ariaLabel: string }) {
  const track = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const measure = () => {
    const el = track.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 8);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 8);
  };

  useEffect(() => {
    measure();
    const el = track.current;
    if (!el) return;
    el.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      el.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, []);

  const step = (dir: 1 | -1) => {
    const el = track.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.round(el.clientWidth * 0.85), behavior: 'smooth' });
  };

  return (
    <div className="relative">
      <div
        ref={track}
        role="list"
        aria-label={ariaLabel}
        className="rail -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth px-4 pb-2 sm:mx-0 sm:px-0"
      >
        {children}
      </div>

      {canLeft && (
        <button
          type="button"
          aria-label="Scroll left"
          onClick={() => step(-1)}
          className="absolute -left-4 top-[30%] hidden h-12 w-12 items-center justify-center rounded-full border bg-[var(--surface)] shadow-[var(--shadow)] transition hover:bg-[var(--surface-2)] md:flex"
        >
          <Chevron flip />
        </button>
      )}
      {canRight && (
        <button
          type="button"
          aria-label="Scroll right"
          onClick={() => step(1)}
          className="absolute -right-4 top-[30%] hidden h-12 w-12 items-center justify-center rounded-full border bg-[var(--surface)] shadow-[var(--shadow)] transition hover:bg-[var(--surface-2)] md:flex"
        >
          <Chevron />
        </button>
      )}
    </div>
  );
}

function Chevron({ flip = false }: { flip?: boolean }) {
  return (
    <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className={flip ? 'rotate-180' : ''}>
      <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
