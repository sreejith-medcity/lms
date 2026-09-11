'use client';

import Link from 'next/link';
import { useState } from 'react';

export interface RailMaterial {
  id: string;
  title: string;
  typeLabel: string;
  duration: string | null;
  done: boolean;
  bookmarked: boolean;
  /** Set when the lesson has not been released yet. */
  lockedLabel?: string | null;
}

export interface RailModule {
  id: string;
  name: string;
  sections: { id: string; title: string; materials: RailMaterial[] }[];
}

/**
 * The curriculum, as an accordion of sections with the current one open.
 * Each section header carries how many of its lessons are done and how long
 * the whole section runs, which is what a learner uses to decide whether to
 * start it tonight.
 */
export function Rail({
  productId,
  currentId,
  modules,
}: {
  productId: string;
  currentId: string;
  modules: RailModule[];
}) {
  const currentModule = modules.find((m) =>
    m.sections.some((s) => s.materials.some((mat) => mat.id === currentId)),
  );
  const [open, setOpen] = useState<Record<string, boolean>>(
    currentModule ? { [currentModule.id]: true } : modules[0] ? { [modules[0].id]: true } : {},
  );

  return (
    <nav className="flex-1 overflow-y-auto" aria-label="Course contents">
      <p className="border-b px-4 py-3 text-sm font-bold">Course content</p>
      {modules.map((m, index) => {
        const items = m.sections.flatMap((s) => s.materials);
        const doneCount = items.filter((i) => i.done).length;
        const isOpen = Boolean(open[m.id]);

        return (
          <div key={m.id} className="border-b">
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpen((o) => ({ ...o, [m.id]: !o[m.id] }))}
              className="flex w-full items-start justify-between gap-2 bg-[var(--canvas)] px-4 py-3 text-left hover:bg-[var(--surface-2)]"
            >
              <span className="min-w-0">
                <span className="block text-sm font-semibold leading-snug">
                  Section {index + 1}: {m.name}
                </span>
                <span className="t-micro faint tabular-nums">
                  {doneCount} / {items.length} · {items.length} lesson{items.length === 1 ? '' : 's'}
                </span>
              </span>
              <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`mt-1 shrink-0 transition ${isOpen ? 'rotate-180' : ''}`}>
                <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {isOpen && (
              <ul className="py-1">
                {m.sections.map((s) => (
                  <li key={s.id}>
                    {m.sections.length > 1 && (
                      <p className="t-micro faint px-4 pb-1 pt-2 font-semibold uppercase tracking-wide">{s.title}</p>
                    )}
                    <ul>
                      {s.materials.map((mat, i) => {
                        const current = mat.id === currentId;
                        const locked = Boolean(mat.lockedLabel);
                        const inner = (
                          <>
                            <span
                              aria-hidden
                              className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-[3px] border text-[10px] ${
                                mat.done ? 'border-transparent text-white' : 'border-[var(--line-strong)] text-transparent'
                              }`}
                              style={mat.done ? { background: 'var(--brand)' } : undefined}
                            >
                              ✓
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className={`block text-sm leading-snug ${locked ? 'faint' : ''}`}>
                                {i + 1}. {mat.title}
                              </span>
                              <span className="t-micro faint flex items-center gap-1">
                                <TypeIcon label={mat.typeLabel} />
                                {locked ? mat.lockedLabel : `${mat.typeLabel}${mat.duration ? ` · ${mat.duration}` : ''}`}
                              </span>
                            </span>
                            {!locked && mat.bookmarked && (
                              <span aria-label="Bookmarked" className="shrink-0 text-[var(--warn)]">★</span>
                            )}
                            {locked && <span aria-hidden className="faint shrink-0">🔒</span>}
                          </>
                        );
                        return (
                          <li key={mat.id}>
                            {locked ? (
                              <span className="flex cursor-not-allowed items-start gap-2.5 px-4 py-2" title={mat.lockedLabel ?? undefined}>
                                {inner}
                              </span>
                            ) : (
                              <Link
                                href={`/learn/${productId}/${mat.id}`}
                                aria-current={current ? 'page' : undefined}
                                className={`flex items-start gap-2.5 px-4 py-2 transition ${
                                  current ? 'bg-[var(--brand-soft)] font-medium' : 'hover:bg-[var(--surface-2)]'
                                }`}
                              >
                                {inner}
                              </Link>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function TypeIcon({ label }: { label: string }) {
  const l = label.toLowerCase();
  const d = l.includes('video')
    ? 'M8 5v14l11-7z'
    : l.includes('audio')
      ? 'M9 18V6l12-2v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm12-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0z'
      : l.includes('pdf') || l.includes('doc') || l.includes('text')
        ? 'M6 2h9l5 5v15H6zM14 2v6h6M8 13h8M8 17h8'
        : 'M4 6h16M4 12h16M4 18h10';
  return (
    <svg aria-hidden width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}
