'use client';

import { useEffect, useState } from 'react';

/**
 * The enrol bar on a phone.
 *
 * A bar that is there from the first paint covers the top of the page while
 * somebody is still reading the headline, and it duplicates a button that is
 * already on screen. So it stays out of the way until the purchase card has
 * scrolled past, and slides in once it has, which is the point at which a
 * reader who wants to buy would otherwise have to scroll back up.
 *
 * This was an IntersectionObserver on the anchor, which was the obvious tool
 * and the wrong one. An observer only fires when the intersection changes, and
 * a fast flick back to the top of a long page can take the anchor from "above
 * the viewport" straight to "below the viewport" without ever intersecting it.
 * No callback, no update, and the bar stayed on screen at the top of the page.
 * Found by scrolling a real hydrated page rather than by reading the code.
 *
 * A scroll listener does not have that failure: it answers the question from
 * the position rather than from the crossing, so every reading is correct
 * whatever route the page took to get there. Coalesced into a frame, and
 * passive, so it never blocks the scroll it is watching.
 */
export function EnrolBar({ children }: { children: React.ReactNode }) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    let frame = 0;

    const measure = () => {
      frame = 0;
      const anchor = document.getElementById('enrol-anchor');
      // No anchor means no purchase card was rendered, and then the bar is
      // the only way to buy rather than a duplicate of one.
      setShown(anchor ? anchor.getBoundingClientRect().top < 0 : true);
    };

    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });

    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
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
