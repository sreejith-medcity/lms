'use client';

import Link from 'next/link';
import { useId, useState } from 'react';

/**
 * The extra, offered on a catalogue card, together with the button it changes.
 *
 * The card is a server component and stays one. This is the only piece of it
 * that runs in the browser, and it is only rendered for the courses that
 * actually have an extra attached, so sixty cards do not each ship a checkbox
 * nobody needs.
 *
 * It owns the enrol link as well as the tick box, because a checkbox that
 * cannot change the thing it is meant to change is decoration. Ticking it
 * carries the choice in the address rather than in storage, so it survives
 * the trip to the course page, a middle-click into a new tab, and a share.
 * Nothing is added to a cart here: the full price is shown on the course page
 * before anybody pays.
 */
export function AddonToggle({
  href,
  addonProductId,
  label,
  priceLabel,
}: {
  /** Where enrol goes without the extra. */
  href: string;
  addonProductId: string;
  label: string;
  priceLabel: string;
}) {
  const [on, setOn] = useState(false);
  const id = useId();

  return (
    <>
      <label
        htmlFor={id}
        className={`mb-2.5 flex cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] border px-2.5 py-2 transition
          ${on ? 'border-[var(--brand)]' : 'hover:border-[var(--line-strong)]'}`}
        style={on ? { background: 'var(--brand-soft)' } : undefined}
      >
        <input
          id={id}
          type="checkbox"
          checked={on}
          onChange={(e) => setOn(e.target.checked)}
          className="h-4 w-4 shrink-0 rounded border-[var(--line-strong)] accent-[var(--brand)]"
        />
        <span className="t-small min-w-0 flex-1 truncate font-medium">{label}</span>
        <span className="t-small shrink-0 font-semibold tabular-nums">{priceLabel}</span>
      </label>

      <div className="grid grid-cols-2 gap-2">
        <Link
          href={href}
          className="inline-flex h-10 items-center justify-center rounded-[var(--radius-sm)] border
            bg-[var(--surface)] px-3 text-sm font-medium transition
            hover:border-[var(--brand)] hover:text-[var(--brand)]"
        >
          Details
        </Link>
        <Link
          href={on ? `${href}?add=${encodeURIComponent(addonProductId)}#enrol` : `${href}#enrol`}
          className="inline-flex h-10 items-center justify-center gap-1.5 rounded-[var(--radius-sm)]
            px-3 text-sm font-semibold transition hover:brightness-105"
          style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
        >
          Enrol now
          <span aria-hidden>→</span>
        </Link>
      </div>
    </>
  );
}
