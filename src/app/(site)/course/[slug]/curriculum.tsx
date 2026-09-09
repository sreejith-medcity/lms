'use client';

import Link from 'next/link';
import { useState } from 'react';

interface Material {
  id: string;
  title: string;
  typeLabel: string;
  duration: string | null;
  isFreePreview: boolean;
}

interface Module {
  id: string;
  name: string;
  sections: { id: string; title: string; materials: Material[] }[];
}

/**
 * Open on the first module, collapsed after that. A visitor should be able to
 * see the shape of the course at a glance and drill into any part of it, without
 * a wall of two hundred lesson titles.
 */
export function Curriculum({ modules }: { modules: Module[] }) {
  const [open, setOpen] = useState<Record<string, boolean>>(
    modules.length ? { [modules[0].id]: true } : {},
  );

  if (modules.length === 0) {
    return (
      <div className="rounded-[var(--radius)] border border-dashed bg-[var(--surface)] p-8 text-center">
        <p className="t-small muted">The curriculum for this course is still being prepared.</p>
      </div>
    );
  }

  return (
    <div className="divide-y overflow-hidden rounded-[var(--radius)] border bg-[var(--surface)]">
      {modules.map((m) => {
        const count = m.sections.reduce((n, s) => n + s.materials.length, 0);
        const isOpen = Boolean(open[m.id]);

        return (
          <div key={m.id}>
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpen((o) => ({ ...o, [m.id]: !o[m.id] }))}
              className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left hover:bg-[var(--surface-2)]"
            >
              <span className="text-sm font-medium">{m.name}</span>
              <span className="t-small faint flex shrink-0 items-center gap-3">
                {count} lesson{count === 1 ? '' : 's'}
                <span aria-hidden className={`transition ${isOpen ? 'rotate-180' : ''}`}>
                  ⌄
                </span>
              </span>
            </button>

            {isOpen && (
              <div className="border-t bg-[var(--surface-2)]/50">
                {m.sections.map((s) => (
                  <div key={s.id} className="px-5 py-3">
                    <p className="t-micro faint font-semibold uppercase tracking-wide">{s.title}</p>
                    <ul className="mt-2 space-y-1.5">
                      {s.materials.map((mat) => (
                        <li key={mat.id} className="flex items-center justify-between gap-3">
                          <span className="t-small min-w-0 truncate">{mat.title}</span>
                          <span className="t-small faint flex shrink-0 items-center gap-2">
                            {mat.isFreePreview && (
                              <Link href="/sample" className="underline" style={{ color: 'var(--brand)' }}>
                                Preview
                              </Link>
                            )}
                            <span>{mat.typeLabel}</span>
                            {mat.duration && <span>{mat.duration}</span>}
                          </span>
                        </li>
                      ))}
                      {s.materials.length === 0 && (
                        <li className="t-small faint">Nothing published in this section yet.</li>
                      )}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
