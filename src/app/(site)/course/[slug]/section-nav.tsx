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
    const nodes = items
      .map((i) => document.getElementById(i.id))
      .filter((n): n is HTMLElement => Boolean(n));
    if (nodes.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // The topmost section currently crossing the band under the header
        // wins. Taking the last entry instead makes the highlight jump about
        // when two short sections are on screen together.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setCurrent(visible[0].target.id);
      },
      { rootMargin: '-96px 0px -60% 0px', threshold: 0 },
    );

    for (const node of nodes) observer.observe(node);
    return () => observer.disconnect();
  }, [items]);

  return (
    <nav
      aria-label="On this page"
      className="sticky top-0 z-20 -mx-4 border-b px-4 backdrop-blur sm:mx-0 sm:px-0"
      style={{ background: 'color-mix(in srgb, var(--surface) 92%, transparent)' }}
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
