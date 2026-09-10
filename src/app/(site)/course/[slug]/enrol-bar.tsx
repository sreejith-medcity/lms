'use client';

import { useEffect, useState } from 'react';

/**
 * The enrol bar on a phone.
 *
 * A bar that is there from the first paint covers the top of the page while
 * somebody is still reading the headline, and it duplicates a button that is
 * already on screen. So it stays out of the way until the real purchase card
 * has scrolled past, and slides in once it has, which is the point at which a
 * reader who wants to buy has to scroll back up to do it.
 *
 * The observer watches an anchor the server rendered next to that card, so
 * there is no measuring and no scroll handler firing on every frame.
 */
export function EnrolBar({ children }: { children: React.ReactNode }) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const anchor = document.getElementById('enrol-anchor');
    if (!anchor) {
      // No anchor means no purchase card was rendered. Showing the bar is then
      // the right answer, not the fallback.
      setShown(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => setShown(!entry.isIntersecting && entry.boundingClientRect.top < 0),
      { threshold: 0 },
    );
    observer.observe(anchor);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      aria-hidden={!shown}
      className={`fixed inset-x-0 bottom-0 z-30 border-t bg-[var(--surface)] px-3 py-2.5
        shadow-[0_-4px_20px_rgba(50,32,70,0.14)] transition-transform duration-200 lg:hidden
        motion-reduce:transition-none ${shown ? 'translate-y-0' : 'translate-y-full'}`}
      style={{ paddingBottom: 'calc(0.625rem + env(safe-area-inset-bottom))' }}
    >
      <div className="flex items-center justify-between gap-3">{children}</div>
    </div>
  );
}
