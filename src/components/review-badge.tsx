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
  onDark = false,
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
  /** On the purple hero panel, where the page's ink would be unreadable. */
  onDark?: boolean;
  className?: string;
}) {
  if (!rating.trim() || !reviewCount.trim()) return null;

  return (
    <span
      // w-fit, because inside a card's flex column an inline-flex still gets
      // stretched to the full width and the pill reads as an empty bar.
      className={`inline-flex w-fit max-w-full items-center gap-2 self-start whitespace-nowrap
        rounded-full border px-2.5 py-1 ${onDark ? '' : 'bg-[var(--surface)]'} ${className}`}
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
      <span
        className="t-small font-semibold tabular-nums"
        style={onDark ? { color: 'var(--shell-ink)' } : undefined}
      >
        {rating}
      </span>
      {!compact && (
        <>
          <span
            aria-hidden
            className="h-3 w-px"
            style={{ background: onDark ? 'var(--shell-line)' : 'var(--line-strong)' }}
          />
          <span
            className={`t-small tabular-nums ${onDark ? '' : 'faint'}`}
            style={onDark ? { color: 'var(--shell-muted)' } : undefined}
          >
            {reviewCount} reviews
          </span>
        </>
      )}
    </span>
  );
}

/**
 * A provider's own embed, pasted into settings.
 *
 * The obvious build is `dangerouslySetInnerHTML` plus a mount effect that
 * re-creates each `<script>`, because React renders a script tag from a
 * string but the browser will not run one that arrived that way. That is
 * what this was, and against the real Trustindex loader it failed in a way
 * worth writing down: every request succeeded, every global was defined, and
 * no widget appeared.
 *
 * The reason is that these loaders are anchored to their own script tag. They
 * fetch their content and then insert it next to where they were called from.
 * The server had already sent the script inside the page, so the browser ran
 * it during parsing, and the effect then replaced that tag with a fresh one.
 * Replacing detaches the original, so by the time the loader's fetch came
 * back it was inserting the widget beside a node no longer in the document.
 * The widget rendered perfectly, into nothing anybody can see.
 *
 * So the markup is not server-rendered at all. The container goes out empty
 * and is filled here on mount, once, with scripts this code created. React
 * owns no children inside it, so nothing it does later can detach them, and a
 * soft navigation behaves exactly like a first load rather than being the one
 * case where the embed silently does not run. The cost is that a widget below
 * the fold arrives a moment after the page, which is the right trade for a
 * third-party script anyway.
 */
export function ReviewWidget({ html, className = '' }: { html: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = ref.current;
    if (!host || !html.trim()) return;

    // A template parses the markup without running or fetching anything, so
    // what lands in the page is only what we deliberately move there.
    const parsed = document.createElement('template');
    parsed.innerHTML = html;

    for (const node of Array.from(parsed.content.childNodes)) {
      if (node instanceof HTMLScriptElement) {
        const script = document.createElement('script');
        for (const attr of Array.from(node.attributes)) {
          script.setAttribute(attr.name, attr.value);
        }
        script.text = node.textContent ?? '';
        host.appendChild(script);
      } else {
        host.appendChild(node);
      }
    }

    return () => {
      // Strict mode mounts twice in development, and two copies of a review
      // widget is a confusing thing to debug.
      host.replaceChildren();
    };
  }, [html]);

  if (!html.trim()) return null;

  return <div ref={ref} className={className} />;
}
