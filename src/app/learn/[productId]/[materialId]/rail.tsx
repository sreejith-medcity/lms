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
}

export interface RailModule {
  id: string;
  name: string;
  sections: { id: string; title: string; materials: RailMaterial[] }[];
}

/**
 * The curriculum, always in view.
 *
 * A learner should never have to go back to a contents page to see where they
 * are in a course. The rail stays open on desktop and collapses to a sheet on a
 * phone, and the module holding the current lesson is the one that starts open.
 */
export function Rail({
  productId,
  courseTitle,
  currentId,
  modules,
  completed,
  total,
}: {
  productId: string;
  courseTitle: string;
  currentId: string;
  modules: RailModule[];
  completed: number;
  total: number;
}) {
  const currentModule = modules.find((m) =>
    m.sections.some((s) => s.materials.some((mat) => mat.id === currentId)),
  );

  const [open, setOpen] = useState<Record<string, boolean>>(
    currentModule ? { [currentModule.id]: true } : {},
  );
  const [sheet, setSheet] = useState(false);

  const percent = total ? Math.round((completed / total) * 100) : 0;

  const body = (
    <>
      <div className="border-b p-4">
        <Link href={`/learn/${productId}`} className="t-small faint hover:underline">
          {courseTitle}
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-2)]">
            <div
              className="h-full rounded-full"
              style={{ width: `${percent}%`, background: 'var(--brand)' }}
            />
          </div>
          <span className="t-small faint shrink-0 tabular-nums">
            {completed}/{total}
          </span>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto p-2" aria-label="Course contents">
        {modules.map((m) => {
          const items = m.sections.flatMap((s) => s.materials);
          const doneCount = items.filter((i) => i.done).length;
          const isOpen = Boolean(open[m.id]);

          return (
            <div key={m.id} className="mb-1">
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpen((o) => ({ ...o, [m.id]: !o[m.id] }))}
                className="flex w-full items-center justify-between gap-2 rounded-[var(--radius-sm)] px-3 py-2 text-left hover:bg-[var(--surface-2)]"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{m.name}</span>
                  <span className="t-micro faint tabular-nums">
                    {doneCount} of {items.length} done
                  </span>
                </span>
                <span aria-hidden className={`faint shrink-0 transition ${isOpen ? 'rotate-180' : ''}`}>
                  ⌄
                </span>
              </button>

              {isOpen &&
                m.sections.map((s) => (
                  <div key={s.id} className="mt-1">
                    <p className="t-micro faint px-3 py-1 font-semibold uppercase tracking-wide">
                      {s.title}
                    </p>
                    <ul>
                      {s.materials.map((mat) => {
                        const current = mat.id === currentId;
                        return (
                          <li key={mat.id}>
                            <Link
                              href={`/learn/${productId}/${mat.id}`}
                              onClick={() => setSheet(false)}
                              aria-current={current ? 'page' : undefined}
                              className={`flex items-start gap-2.5 rounded-[var(--radius-sm)] px-3 py-2 text-sm transition ${
                                current
                                  ? 'bg-[var(--brand-soft)] font-medium'
                                  : 'hover:bg-[var(--surface-2)]'
                              }`}
                            >
                              <span
                                aria-hidden
                                className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border text-[9px] ${
                                  mat.done ? 'border-transparent text-white' : 'text-transparent'
                                }`}
                                style={mat.done ? { background: 'var(--brand)' } : undefined}
                              >
                                ✓
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block leading-snug">{mat.title}</span>
                                <span className="t-micro faint">
                                  {mat.typeLabel}
                                  {mat.duration ? ` · ${mat.duration}` : ''}
                                </span>
                              </span>
                              {mat.bookmarked && (
                                <span aria-label="Bookmarked" className="shrink-0 text-[var(--warn)]">
                                  ★
                                </span>
                              )}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
            </div>
          );
        })}
      </nav>
    </>
  );

  return (
    <>
      <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-72 shrink-0 flex-col border-r bg-[var(--surface)] lg:flex">
        {body}
      </aside>

      <div className="lg:hidden">
        <button
          type="button"
          onClick={() => setSheet(true)}
          className="flex w-full items-center justify-between gap-3 border-b bg-[var(--surface)] px-4 py-2.5 text-sm"
        >
          <span className="font-medium">Contents</span>
          <span className="t-small faint tabular-nums">
            {completed}/{total} done
          </span>
        </button>

        {sheet && (
          <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label="Course contents">
            <button
              aria-label="Close contents"
              className="flex-1 bg-black/40"
              onClick={() => setSheet(false)}
            />
            <div className="flex w-80 max-w-[85vw] flex-col bg-[var(--surface)]">{body}</div>
          </div>
        )}
      </div>
    </>
  );
}
