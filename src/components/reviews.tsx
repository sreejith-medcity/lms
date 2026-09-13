'use client';

import { useState } from 'react';
import { Rating } from '@/components/rating';
import type { ReviewSummary } from '@/lib/reviews';

export interface ReviewCardData {
  id: string;
  authorName: string;
  rating: number;
  comment: string;
  /** "Verified learner", "Completed the course", or nothing for one the team typed in. */
  badge: string | null;
  when: string;
  reply: string | null;
  repliedWhen: string | null;
}

/**
 * The reviews block on a course page: the average and the five bars at the
 * top, because "4.6 from 38" is what people scan for, then the reviews
 * themselves, a handful at first and the rest on request. The academy's
 * reply sits under the review it answers, which is the one thing that tells
 * a stranger somebody is listening.
 */
export function Reviews({
  summary,
  reviews,
  academyName,
  initial = 6,
}: {
  summary: ReviewSummary;
  reviews: ReviewCardData[];
  academyName: string;
  initial?: number;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? reviews : reviews.slice(0, initial);

  return (
    <div className="space-y-5">
      {summary.count > 0 && (
        <div className="grid gap-5 rounded-[var(--radius)] border bg-[var(--surface)] p-5 sm:grid-cols-[auto_1fr] sm:items-center">
          <div className="text-center sm:pr-6 sm:text-left">
            <p className="text-4xl font-bold tabular-nums leading-none">{summary.average.toFixed(1)}</p>
            <Rating average={summary.average} count={summary.count} showCount={false} className="mt-2" />
            <p className="t-small faint mt-1">
              {summary.count} {summary.count === 1 ? 'review' : 'reviews'}
              {summary.count >= 3 && ` · ${summary.recommendPercent}% gave four stars or more`}
            </p>
          </div>
          <ul className="space-y-1.5" aria-label="Ratings by star">
            {summary.bars.map((bar) => (
              <li key={bar.stars} className="flex items-center gap-2">
                <span className="t-small w-12 shrink-0 tabular-nums faint">{bar.stars} star{bar.stars === 1 ? '' : 's'}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--surface-2)]">
                  <span className="block h-full rounded-full" style={{ width: `${bar.percent}%`, background: 'var(--accent)' }} />
                </span>
                <span className="t-small w-8 shrink-0 text-right tabular-nums faint">{bar.count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {reviews.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {shown.map((r) => (
            <li key={r.id} className="flex flex-col rounded-[var(--radius)] border bg-[var(--surface)] p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Rating average={r.rating} count={1} showCount={false} />
                {r.badge && (
                  <span className="t-micro rounded-full px-2 py-0.5 font-semibold" style={{ background: 'var(--ok-soft)', color: 'var(--ok)' }}>
                    {r.badge}
                  </span>
                )}
              </div>
              <p className="t-small mt-2.5 leading-relaxed">{r.comment}</p>
              <p className="t-small faint mt-2.5">
                {r.authorName} · {r.when}
              </p>
              {r.reply && (
                <div className="mt-3 rounded-[var(--radius-sm)] border-l-4 bg-[var(--surface-2)] p-3" style={{ borderColor: 'var(--brand)' }}>
                  <p className="t-small faint">
                    <span className="font-semibold" style={{ color: 'var(--ink-2)' }}>{academyName}</span> replied{r.repliedWhen ? ` · ${r.repliedWhen}` : ''}
                  </p>
                  <p className="t-small mt-1 leading-relaxed">{r.reply}</p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {reviews.length > initial && !all && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="t-small rounded-[var(--radius-sm)] border px-4 py-2 font-semibold"
        >
          Show all {reviews.length} reviews
        </button>
      )}
    </div>
  );
}
