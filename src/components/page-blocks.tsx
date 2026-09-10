import { paragraphs, type Block } from '@/lib/page-blocks';

/**
 * A landing page's own content, rendered in this product's typography rather
 * than the one it was written in.
 *
 * The blocks come from pages that sell: the marketing copy, the outcomes, the
 * questions counsellors answer on the phone forty times a week. It is worth
 * keeping and it is worth reading, so it gets the same measure and the same
 * type scale as everything else here instead of arriving as a foreign slab.
 */
export function PageBlocks({
  blocks,
  ctaHref = '#enrol',
  className = '',
}: {
  blocks: Block[];
  ctaHref?: string;
  className?: string;
}) {
  if (blocks.length === 0) return null;

  return (
    <div className={`space-y-10 ${className}`}>
      {blocks.map((block, i) => (
        <section key={i}>
          {'heading' in block && block.heading && (
            /* A step below the section heading above it, since these are the
               parts of one section rather than sections of their own. */
            <h3 className="t-title mb-3">{block.heading}</h3>
          )}

          {block.type === 'text' && (
            <div className="space-y-3">
              {paragraphs(block.body).map((p, n) => (
                <p key={n} className="t-lead muted leading-relaxed">
                  {p}
                </p>
              ))}
            </div>
          )}

          {block.type === 'bullets' && (
            <ul className="grid gap-2.5 sm:grid-cols-2">
              {block.items.map((item, n) => (
                <li key={n} className="flex gap-2.5">
                  <span aria-hidden className="mt-1.5 shrink-0" style={{ color: 'var(--brand)' }}>
                    <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
                      <path
                        d="m3 8.5 3.2 3.2L13 5"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  <span className="t-body">{item}</span>
                </li>
              ))}
            </ul>
          )}

          {block.type === 'stats' && (
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {block.items.map((item, n) => (
                <div
                  key={n}
                  className="rounded-[var(--radius)] border bg-[var(--surface)] p-4 text-center"
                >
                  <dt className="t-price" style={{ color: 'var(--brand)' }}>
                    {item.value}
                  </dt>
                  <dd className="t-small muted mt-1">{item.label}</dd>
                </div>
              ))}
            </dl>
          )}

          {block.type === 'faq' && (
            <div className="divide-y rounded-[var(--radius-lg)] border bg-[var(--surface)]">
              {block.items.map((item, n) => (
                <details key={n} className="group p-4 open:pb-5">
                  <summary className="t-heading flex cursor-pointer list-none items-center justify-between gap-4">
                    {item.q}
                    <span
                      aria-hidden
                      className="shrink-0 transition group-open:rotate-45"
                      style={{ color: 'var(--brand)' }}
                    >
                      +
                    </span>
                  </summary>
                  <div className="mt-2 space-y-2">
                    {paragraphs(item.a).map((p, k) => (
                      <p key={k} className="t-body muted">
                        {p}
                      </p>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          )}

          {block.type === 'image' && (
            <figure>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={block.assetId ? `/api/assets/${block.assetId}` : block.url}
                alt={block.alt ?? ''}
                loading="lazy"
                decoding="async"
                className="w-full rounded-[var(--radius-lg)] border object-cover"
              />
              {block.caption && (
                <figcaption className="t-small faint mt-2 text-center">{block.caption}</figcaption>
              )}
            </figure>
          )}

          {block.type === 'cta' && (
            <div
              className="rounded-[var(--radius-lg)] border p-6 text-center"
              style={{ background: 'var(--brand-soft)', borderColor: 'var(--brand-line)' }}
            >
              {block.body && <p className="t-lead">{block.body}</p>}
              <a
                href={ctaHref}
                className="mt-4 inline-flex h-12 items-center rounded-[var(--radius-sm)] px-6 text-sm
                  font-semibold text-[var(--brand-ink)]"
                style={{ background: 'var(--brand)' }}
              >
                {block.label?.trim() || 'See dates and fees'}
              </a>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
