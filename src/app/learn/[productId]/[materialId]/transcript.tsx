'use client';

import { useMemo, useState } from 'react';
import { stamp } from '@/components/media-player';

export interface TranscriptParagraph {
  start: number;
  text: string;
}

/**
 * The lesson as text, following the recording. A paragraph lights up as it
 * is spoken and clicking one seeks to it; the search box narrows to the
 * paragraphs that say the word, which is how you find the ninety seconds
 * that mattered in a two-hour class.
 */
export function TranscriptTab({
  paragraphs,
  currentTime,
  onSeek,
  summary,
  chapters = [],
  searchHref,
}: {
  paragraphs: TranscriptParagraph[];
  currentTime?: number | null;
  onSeek?: (seconds: number) => void;
  summary?: string | null;
  chapters?: { title: string; start: number }[];
  /** Search across the whole course. */
  searchHref: string;
}) {
  const [q, setQ] = useState('');

  const now = currentTime ?? -1;
  const liveIndex = useMemo(() => {
    let i = -1;
    for (let k = 0; k < paragraphs.length; k += 1) if (paragraphs[k].start <= now) i = k;
    return i;
  }, [paragraphs, now]);

  const words = q.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const shown = words.length
    ? paragraphs.map((p, i) => ({ p, i })).filter(({ p }) => words.every((w) => p.text.toLowerCase().includes(w)))
    : paragraphs.map((p, i) => ({ p, i }));

  return (
    <div className="space-y-4">
      {summary && (
        <div className="rounded-[var(--radius)] border bg-[var(--surface)] p-4">
          <p className="t-small font-semibold">In short</p>
          <p className="t-small mt-1 leading-relaxed">{summary}</p>
        </div>
      )}

      {chapters.length > 0 && (
        <ol className="flex flex-wrap gap-2">
          {chapters.map((c) => (
            <li key={`${c.start}-${c.title}`}>
              <button
                type="button"
                onClick={() => onSeek?.(c.start)}
                className="t-small rounded-full border px-3 py-1 hover:border-[var(--brand)]"
              >
                <span className="tabular-nums faint">{stamp(c.start)}</span> {c.title}
              </button>
            </li>
          ))}
        </ol>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find a word in this lesson"
          className="h-9 min-w-0 flex-1 rounded-[var(--radius-sm)] border bg-[var(--surface)] px-3 text-sm"
          aria-label="Search the transcript"
        />
        <a href={searchHref} className="t-small underline" style={{ color: 'var(--brand)' }}>
          Search the whole course
        </a>
      </div>

      {shown.length === 0 ? (
        <p className="t-small faint">Nothing in this lesson says that.</p>
      ) : (
        <ol className="space-y-2">
          {shown.map(({ p, i }) => (
            <li
              key={p.start}
              className="flex gap-3 rounded-[var(--radius-sm)] px-2 py-1.5 transition-colors"
              style={i === liveIndex ? { background: 'var(--brand-soft)' } : undefined}
            >
              <button
                type="button"
                onClick={() => onSeek?.(p.start)}
                className="t-small shrink-0 tabular-nums underline-offset-2 hover:underline"
                style={{ color: 'var(--brand)' }}
                disabled={!onSeek}
              >
                {stamp(p.start)}
              </button>
              <p className="text-sm leading-relaxed">{p.text}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
