'use client';

import { useEffect, useId } from 'react';
import { seedAddons, setAddon, useSelectedAddons } from './addon-selection';

export interface AddonOption {
  productId: string;
  label: string;
  note: string | null;
  priceLabel: string;
  isPreselected: boolean;
}

/**
 * The tick boxes for the extras offered with a course.
 *
 * Nothing is ticked unless the academy said so, or unless the visitor already
 * ticked it on the catalogue card and arrived with `?add=` in the address.
 * A paid extra that ticks itself is a dark pattern, and this product is
 * replacing one that a hundred thousand learners have to trust.
 */
export function AddonPicker({
  productId,
  options,
  className = '',
}: {
  productId: string;
  options: AddonOption[];
  className?: string;
}) {
  const selected = useSelectedAddons(productId);
  const group = useId();

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).getAll('add');
    const offered = new Set(options.map((o) => o.productId));
    seedAddons(productId, [
      ...options.filter((o) => o.isPreselected).map((o) => o.productId),
      ...fromUrl.filter((id) => offered.has(id)),
    ]);
  }, [productId, options]);

  if (options.length === 0) return null;

  return (
    <div className={`space-y-2 ${className}`}>
      {options.map((o) => {
        const id = `${group}-${o.productId}`;
        const on = selected.includes(o.productId);
        return (
          <label
            key={o.productId}
            htmlFor={id}
            className={`flex cursor-pointer items-start gap-3 rounded-[var(--radius-sm)] border p-3 transition
              ${on ? 'border-[var(--brand)]' : 'hover:border-[var(--line-strong)]'}`}
            style={on ? { background: 'var(--brand-soft)' } : undefined}
          >
            <input
              id={id}
              type="checkbox"
              checked={on}
              onChange={(e) => setAddon(productId, o.productId, e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-[var(--line-strong)] accent-[var(--brand)]"
            />
            <span className="min-w-0 flex-1">
              <span className="t-small block font-semibold">{o.label}</span>
              {o.note && <span className="t-small muted block">{o.note}</span>}
            </span>
            <span className="t-small shrink-0 font-semibold tabular-nums">{o.priceLabel}</span>
          </label>
        );
      })}
    </div>
  );
}
