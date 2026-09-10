'use client';

import { useEffect, useRef } from 'react';

/**
 * The Google rating, in two forms, matching what the WordPress storefront does
 * and for the same reason.
 *
 * `GoogleBadge` is a handful of characters of markup. It goes on catalogue
 * cards, where sixty copies of a third-party widget would be sixty network
 * requests for one number.
 *
 * `ReviewWidget` is the provider's real embed, and it appears once, on a course
 * page. It is the only third-party script on an otherwise self-contained page,
 * so it is opt-in: no snippet in settings means no script on the site.
 */

export function GoogleBadge({
  rating,
  reviewCount,
  compact = false,
  className = '',
}: {
  rating: string;
  reviewCount: string;
  /**
   * Drops the review count. A card is 300 pixels wide and the full badge
   * wraps onto two lines in it, which looks like a mistake. The count is
   * still in the label a screen reader reads, so nothing is lost, only
   * unwrapped.
   */
  compact?: boolean;
  className?: string;
}) {
  if (!rating.trim() || !reviewCount.trim()) return null;

  return (
    <span
      // w-fit, because inside a card's flex column an inline-flex still gets
      // stretched to the full width and the pill reads as an empty bar.
      className={`inline-flex w-fit max-w-full items-center gap-2 self-start whitespace-nowrap
        rounded-full border bg-[var(--surface)] px-2.5 py-1 ${className}`}
      role="img"
      aria-label={`Google rating ${rating} out of 5 from ${reviewCount} reviews`}
    >
      <span aria-hidden className="text-[0.8125rem] font-bold tracking-tight">
        <span style={{ color: '#4285F4' }}>G</span>
        <span style={{ color: '#EA4335' }}>o</span>
        <span style={{ color: '#FBBC05' }}>o</span>
        <span style={{ color: '#4285F4' }}>g</span>
        <span style={{ color: '#34A853' }}>l</span>
        <span style={{ color: '#EA4335' }}>e</span>
      </span>
      <span aria-hidden className="text-[0.8125rem]" style={{ color: 'var(--accent)' }}>
        ★★★★★
      </span>
      <span className="t-small font-semibold tabular-nums">{rating}</span>
      {!compact && (
        <>
          <span aria-hidden className="h-3 w-px" style={{ background: 'var(--line-strong)' }} />
          <span className="t-small faint tabular-nums">{reviewCount} reviews</span>
        </>
      )}
    </span>
  );
}

/**
 * A provider's own embed, pasted into settings.
 *
 * React renders the markup but will not run a `<script>` inside
 * `dangerouslySetInnerHTML`, which is why a pasted widget looks like it does
 * nothing. So the markup arrives with the page, and on mount each script node
 * is replaced with a fresh one, which is what makes the browser fetch and run
 * it. Replacing rather than appending keeps the provider's own ordering.
 *
 * This runs whatever a staff member with organisation settings access pasted.
 * That is the same trust already given to the policy editor, and it is the
 * only way to support an embed nobody has written an integration for, but it
 * is worth being clear-eyed that it is a real permission and not a text box.
 */
export function ReviewWidget({ html, className = '' }: { html: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = ref.current;
    if (!host) return;

    for (const old of Array.from(host.querySelectorAll('script'))) {
      const fresh = document.createElement('script');
      for (const attr of Array.from(old.attributes)) {
        fresh.setAttribute(attr.name, attr.value);
      }
      fresh.text = old.textContent ?? '';
      old.replaceWith(fresh);
    }
  }, [html]);

  if (!html.trim()) return null;

  return <div ref={ref} className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
