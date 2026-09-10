'use client';

import { useEffect, useState } from 'react';

/**
 * The in-page nav that sticks under the header.
 *
 * A course page is long by nature: curriculum, batches, trainers, the
 * before-you-enrol table. Without this a buyer who wants one fact has to
 * scroll past four sections looking for it. The current section is highlighted
 * so the strip also answers "how far down am I".
 */
export function SectionNav({
  items,
  trailing,
}: {
  items: { id: string; label: string }[];
  /** Price and buy button, kept in reach once the purchase card scrolls away. */
  trailing?: React.ReactNode;
}) {
  const [current, setCurrent] = useState(items[0]?.id ?? '');

  useEffect(() => {
    let frame = 0;

    const measure = () => {
      frame = 0;

      // The section the reader is in is the last one whose heading has passed
      // under the sticky nav. Before the first one has, it is the first.
      //
      // Deliberately computed from positions rather than watched with an
      // IntersectionObserver. An observer only speaks when a section crosses
      // the band, so a page with nothing in the band, which is exactly what
      // you get at the very top and the very bottom, keeps whatever it said
      // last. The bar at the bottom of a phone had the same bug, and this is
      // the same fix: ask where things are, not when they moved.
      const band = 100;
      let active = items[0]?.id ?? '';

      for (const item of items) {
        const node = document.getElementById(item.id);
        if (node && node.getBoundingClientRect().top <= band) active = item.id;
      }

      setCurrent(active);
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
  }, [items]);

  return (
    <nav
      aria-label="On this page"
      // Opaque rather than translucent. A heading sliding half-visible under
      // a frosted bar reads as an overlap bug rather than as a design.
      className="sticky top-0 z-20 -mx-4 border-b bg-[var(--surface)] px-4 sm:mx-0 sm:px-0" 
    >
      <div className="flex items-center gap-4 py-2">
        <div className="rail flex min-w-0 flex-1 gap-1">
        {items.map((i) => (
          <a
            key={i.id}
            href={`#${i.id}`}
            aria-current={current === i.id ? 'true' : undefined}
            className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition ${
              current === i.id
                ? 'text-[var(--brand-ink)]'
                : 'muted hover:bg-[var(--surface-2)] hover:text-[var(--ink)]'
            }`}
            style={current === i.id ? { background: 'var(--brand)' } : undefined}
          >
            {i.label}
          </a>
          ))}
        </div>
        {trailing && <div className="hidden shrink-0 items-center gap-3 lg:flex">{trailing}</div>}
      </div>
    </nav>
  );
}
