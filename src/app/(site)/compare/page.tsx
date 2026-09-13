import Link from 'next/link';
import type { Metadata } from 'next';
import { db } from '@/lib/db';
import { getSiteContext, courseCardSelect, learningFormat, materialCount, ratingsFor, type CourseCard as Card } from '@/lib/site';
import { formatMoney } from '@/lib/money';
import { NoTenantNotice } from '@/components/tenant-notices';
import { CourseMedia } from '@/components/course-media';
import { Rating } from '@/components/rating';
import { SaveButton } from '@/components/save-button';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Compare courses', robots: { index: false, follow: false } };

/**
 * Up to four courses side by side, on the facts a buyer actually weighs:
 * price, format, length, level, language, batches, rating, instalments.
 * Every cell is read from the course, so the page can never flatter one.
 */
export default async function ComparePage({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  const site = await getSiteContext();
  if (!site) return <NoTenantNotice />;
  const { ids = '' } = await searchParams;
  const wanted = Array.from(new Set(ids.split(',').map((s) => s.trim()).filter(Boolean))).slice(0, 4);

  const products = wanted.length
    ? await db.product.findMany({
        where: { id: { in: wanted }, organizationId: site.organizationId, type: 'COURSE', status: 'PUBLISHED', deletedAt: null, isAddonOnly: false },
        select: courseCardSelect,
      })
    : [];
  const cards = wanted.map((id) => (products as unknown as Card[]).find((p) => p.id === id)).filter((c): c is Card => Boolean(c));
  const ratings = await ratingsFor(site.organizationId, cards.map((c) => c.id));

  if (cards.length < 2) {
    return (
      <div className="mx-auto max-w-[80rem] px-4 py-10 sm:px-6">
        <h1 className="t-display">Compare courses</h1>
        <p className="t-lead mt-2 max-w-prose">Tick “Compare” on two or more courses in the catalogue and they line up here.</p>
        <Link href="/courses" className="mt-6 inline-flex h-11 items-center rounded-[var(--radius-sm)] px-5 text-sm font-semibold text-[var(--brand-ink)]" style={{ background: 'var(--brand)' }}>
          Browse the courses
        </Link>
      </div>
    );
  }

  const hours = (c: Card) => {
    const m = c.course?.durationMinutes ?? 0;
    return m > 0 ? (m >= 90 ? `${Math.round(m / 60)} hours` : `${m} minutes`) : '—';
  };
  const nextBatch = (c: Card) => {
    const b = c.course?.batches[0];
    if (!b) return 'Self-paced';
    return b.startDate ? `Batch from ${b.startDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : 'Live batch';
  };
  const price = (c: Card) => {
    const p = c.pricingPlans[0];
    return p ? formatMoney(p.pricePaise, p.currency) : 'On enquiry';
  };
  const rows: { label: string; cell: (c: Card) => React.ReactNode }[] = [
    { label: 'Price', cell: (c) => <span className="font-semibold tabular-nums">{price(c)}</span> },
    { label: 'Instalments', cell: (c) => ((c.pricingPlans[0]?.instalmentCount ?? 0) > 1 ? `${c.pricingPlans[0].instalmentCount} parts` : 'In full') },
    { label: 'Format', cell: (c) => learningFormat(c) },
    { label: 'Level', cell: (c) => c.course?.level ?? '—' },
    { label: 'Language', cell: (c) => c.course?.language ?? '—' },
    { label: 'Length', cell: hours },
    { label: 'Lessons', cell: (c) => String(materialCount(c) || '—') },
    { label: 'Next batch', cell: nextBatch },
    { label: 'Access after finishing', cell: (c) => (c.course?.accessAfterCompletion ? 'Kept' : 'Ends with the batch') },
    { label: 'Validity', cell: (c) => (c.pricingPlans[0]?.validityDays ? `${c.pricingPlans[0].validityDays} days` : 'No expiry') },
    {
      label: 'Rating',
      cell: (c) => {
        const r = ratings.get(c.id);
        return r ? <Rating average={r.average} count={r.count} /> : <span className="faint">No reviews yet</span>;
      },
    },
    { label: 'Subjects', cell: (c) => c.course?.categories.map((x) => x.category.name).join(', ') || '—' },
  ];

  return (
    <div className="mx-auto max-w-[80rem] px-4 py-8 sm:px-6 sm:py-10">
      <h1 className="t-display">Compare courses</h1>
      <p className="t-lead mt-2 max-w-prose">Side by side, on the facts. Nothing here is written by hand.</p>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[40rem] border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 bg-[var(--canvas)] p-2 text-left align-bottom" />
              {cards.map((c) => (
                <th key={c.id} className="p-2 text-left align-top" style={{ width: `${Math.floor(85 / cards.length)}%` }}>
                  <Link href={`/course/${c.slug}`} className="block overflow-hidden rounded-[var(--radius-sm)] border">
                    <CourseMedia title={c.title} assetId={c.course?.thumbnailAssetId} ratio="aspect-video" />
                  </Link>
                  <Link href={`/course/${c.slug}`} className="mt-2 block font-bold leading-snug hover:text-[var(--brand)]">
                    {c.title}
                  </Link>
                  <div className="mt-2">
                    <SaveButton productId={c.id} compact />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-t">
                <th scope="row" className="sticky left-0 whitespace-nowrap bg-[var(--canvas)] p-2 pr-4 text-left font-medium text-[var(--ink-2)]">
                  {r.label}
                </th>
                {cards.map((c) => (
                  <td key={c.id} className="border-t p-2 align-top">
                    {r.cell(c)}
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <th className="sticky left-0 bg-[var(--canvas)] p-2" />
              {cards.map((c) => (
                <td key={c.id} className="p-2">
                  <Link href={`/course/${c.slug}`} className="inline-flex h-10 items-center rounded-[var(--radius-sm)] px-4 text-sm font-semibold text-[var(--brand-ink)]" style={{ background: 'var(--brand)' }}>
                    See the course
                  </Link>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
