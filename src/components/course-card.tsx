import Link from 'next/link';
import { formatMoney } from '@/lib/money';
import { learningFormat, materialCount, type CourseCard as Card } from '@/lib/site';
import { Badge } from '@/components/ui';

/** One card, used by the homepage, the catalogue and the category pages. */
export function CourseCard({ card }: { card: Card }) {
  const plan = card.pricingPlans[0];
  const batch = card.course?.batches[0];
  const lessons = materialCount(card);
  const format = learningFormat(card);
  const category = card.course?.categories[0]?.category;

  return (
    <Link
      href={`/course/${card.slug}`}
      className="group flex flex-col rounded-[var(--radius)] border bg-[var(--surface)] p-5 shadow-sm
        transition hover:-translate-y-0.5 hover:border-[var(--brand)] hover:shadow-md
        focus-visible:border-[var(--brand)] motion-reduce:hover:translate-y-0"
    >
      <div className="flex flex-wrap items-center gap-2">
        {category && <Badge tone="brand">{category.name}</Badge>}
        <Badge tone="neutral">{format}</Badge>
        {card.course?.level && <Badge tone="neutral">{card.course.level}</Badge>}
      </div>

      <h3 className="mt-3 text-base font-semibold leading-snug group-hover:text-[var(--brand)]">
        {card.title}
      </h3>

      {card.course?.description && (
        <p className="t-small muted mt-1.5 line-clamp-2">{card.course.description}</p>
      )}

      <p className="t-small faint mt-3">
        {lessons > 0 ? `${lessons} lesson${lessons === 1 ? '' : 's'}` : 'Curriculum in preparation'}
        {card.course?.language ? ` · ${card.course.language}` : ''}
        {plan?.validityDays ? ` · ${plan.validityDays} days access` : ''}
      </p>

      <div className="mt-4 flex items-end justify-between gap-3 border-t pt-4">
        <div>
          {plan ? (
            <>
              <span className="text-lg font-semibold tabular-nums">
                {formatMoney(plan.pricePaise, plan.currency)}
              </span>
              {plan.mrpPaise && plan.mrpPaise > plan.pricePaise && (
                <span className="t-small faint ml-2 line-through tabular-nums">
                  {formatMoney(plan.mrpPaise, plan.currency)}
                </span>
              )}
              <span className="t-micro faint block">plus applicable taxes</span>
            </>
          ) : (
            <span className="t-small faint">Price on enquiry</span>
          )}
        </div>

        {batch?.startDate && (
          <span className="t-small faint shrink-0 text-right">
            Next batch
            <span className="block font-medium text-[var(--ink-2)]">
              {batch.startDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
            </span>
          </span>
        )}
      </div>
    </Link>
  );
}
