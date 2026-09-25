import { formatMoney } from '@/lib/money';
import { AddToCart } from '@/components/add-to-cart';
import { packLine, type PackCard } from '@/lib/exams/packs';

/** Packs of papers, bought through the ordinary cart. */
export function PackCards({ packs, title = 'Packs' }: { packs: PackCard[]; title?: string }) {
  const priced = packs.filter((p) => p.pricePaise != null && p.pricePaise > 0 && p.pricingPlanId);
  if (!priced.length) return null;
  return (
    <div className="mt-6">
      <h3 className="t-heading">{title}</h3>
      <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {priced.map((p) => (
          <div key={p.productId} className="glass-card flex flex-col rounded-[var(--radius)] border bg-[var(--surface)] p-5">
            <span className="font-semibold">{p.title}</span>
            <span className="t-small muted mt-1">{packLine(p)}</span>
            {p.description && <span className="t-small mt-2">{p.description}</span>}
            <span className="mt-4 flex-1 text-2xl font-semibold tabular-nums">
              {formatMoney(p.pricePaise!, p.currency)}
              {p.mrpPaise && p.mrpPaise > p.pricePaise! ? <span className="t-small faint ml-2 line-through">{formatMoney(p.mrpPaise, p.currency)}</span> : null}
            </span>
            <div className="mt-4">
              <AddToCart productId={p.productId} pricingPlanId={p.pricingPlanId!} fullWidth label="Buy this pack" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
