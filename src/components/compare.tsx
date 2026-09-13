'use client';

import { useEffect, useState } from 'react';

const KEY = 'mlms_compare';
const EVENT = 'mlms:compare';
export const COMPARE_MAX = 4;

function read(): { id: string; title: string }[] {
  try {
    const raw = sessionStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as { id: string; title: string }[]) : [];
    return Array.isArray(parsed) ? parsed.filter((p) => p && typeof p.id === 'string').slice(0, COMPARE_MAX) : [];
  } catch {
    return [];
  }
}

function write(list: { id: string; title: string }[]) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(list.slice(0, COMPARE_MAX)));
  } catch {
    /* private mode: the bar simply forgets on navigation */
  }
  window.dispatchEvent(new Event(EVENT));
}

/**
 * "Compare" on a card. The picks live in this tab's session storage, so
 * the catalogue page can be cached and the choice still follows the
 * visitor from page to page until they open the comparison.
 */
export function CompareToggle({ productId, title }: { productId: string; title: string }) {
  const [on, setOn] = useState(false);
  const [full, setFull] = useState(false);

  useEffect(() => {
    const sync = () => {
      const list = read();
      setOn(list.some((p) => p.id === productId));
      setFull(list.length >= COMPARE_MAX);
    };
    sync();
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, [productId]);

  return (
    <label className={`t-small inline-flex cursor-pointer items-center gap-1.5 ${!on && full ? 'opacity-50' : ''}`}>
      <input
        type="checkbox"
        checked={on}
        disabled={!on && full}
        onChange={(e) => {
          const list = read().filter((p) => p.id !== productId);
          write(e.target.checked ? [...list, { id: productId, title }] : list);
        }}
        className="h-4 w-4 accent-[var(--brand)]"
      />
      Compare
    </label>
  );
}

/** The bar at the bottom once two courses are ticked. */
export function CompareBar() {
  const [list, setList] = useState<{ id: string; title: string }[]>([]);
  useEffect(() => {
    const sync = () => setList(read());
    sync();
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  if (list.length === 0) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-[var(--surface)] px-4 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.08)]">
      <div className="mx-auto flex max-w-[80rem] flex-wrap items-center gap-3">
        <span className="t-small font-semibold">Compare ({list.length} of {COMPARE_MAX})</span>
        <ul className="flex min-w-0 flex-1 flex-wrap gap-1.5">
          {list.map((p) => (
            <li key={p.id} className="t-small inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5">
              <span className="max-w-[10rem] truncate">{p.title}</span>
              <button type="button" aria-label={`Remove ${p.title}`} className="faint" onClick={() => write(read().filter((x) => x.id !== p.id))}>
                ×
              </button>
            </li>
          ))}
        </ul>
        <a
          href={`/compare?ids=${list.map((p) => encodeURIComponent(p.id)).join(',')}`}
          aria-disabled={list.length < 2}
          className={`inline-flex h-10 items-center rounded-[var(--radius-sm)] px-4 text-sm font-semibold text-[var(--brand-ink)] ${list.length < 2 ? 'pointer-events-none opacity-50' : ''}`}
          style={{ background: 'var(--brand)' }}
        >
          Compare
        </a>
        <button type="button" className="t-small underline faint" onClick={() => write([])}>
          Clear
        </button>
      </div>
    </div>
  );
}
