/**
 * The first thing a keyboard reaches on every shell: one link straight to
 * the page's content, past the sidebar and the header. Invisible until it
 * has focus, so nobody with a mouse ever sees it.
 */
export function SkipLink({ label = 'Skip to content' }: { label?: string }) {
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50
        focus:rounded-[var(--radius-sm)] focus:bg-[var(--surface)] focus:px-4 focus:py-2 focus:shadow-lg"
    >
      {label}
    </a>
  );
}
