import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { getSiteContext, courseCardSelect, ratingsFor, type CourseCard as Card } from '@/lib/site';
import { formatMoney } from '@/lib/money';
import { bundleSaving } from '@/lib/learning-paths';
import { CourseMedia } from '@/components/course-media';
import { CourseCard } from '@/components/course-card';
import { NoTenantNotice } from '@/components/tenant-notices';
import { AddToCart } from '@/components/add-to-cart';
import { TrackEvent } from '@/components/track-event';
import { CourseCta } from '@/app/(site)/course/[slug]/course-cta';

export const dynamic = 'force-dynamic';

async function load(slug: string) {
  const site = await getSiteContext();
  if (!site) return null;
  const product = await db.product.findFirst({
    where: { organizationId: site.organizationId, slug, type: 'BUNDLE', status: 'PUBLISHED', deletedAt: null },
    select: {
      id: true,
      title: true,
      slug: true,
      isFeatured: true,
      pricingPlans: {
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, name: true, pricePaise: true, mrpPaise: true, currency: true, planType: true, instalmentCount: true, validityDays: true },
      },
      bundle: {
        select: {
          description: true,
          thumbnailAssetId: true,
          items: {
            orderBy: { sortOrder: 'asc' },
            select: { product: { select: courseCardSelect } },
          },
        },
      },
    },
  });
  if (!product?.bundle) return null;
  return { site, product, bundle: product.bundle };
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const found = await load(slug);
  if (!found) return { title: 'Bundle not found' };
  const description = found.bundle.description?.slice(0, 155) ?? `${found.product.title} at ${found.site.organization.name}.`;
  return {
    title: `${found.product.title} — ${found.site.organization.name}`,
    description,
    alternates: { canonical: `/bundle/${found.product.slug}` },
    openGraph: { title: found.product.title, description, type: 'website' },
  };
}

/**
 * A bundle's own page: what is inside, in the order to take it, and what
 * the set costs against the courses bought apart. The buy button is the
 * course one, so a signed-in learner who already owns a course inside
 * still sees a price for the rest, and checkout sorts out the enrolments.
 */
export default async function BundlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const site = await getSiteContext();
  if (!site) return <NoTenantNotice />;
  const found = await load(slug);
  if (!found) notFound();
  const { product, bundle } = found;

  const cards = bundle.items.map((i) => i.product as unknown as Card).filter((c) => c.course);
  const ratings = await ratingsFor(site.organizationId, cards.map((c) => c.id));

  const plan = product.pricingPlans[0];
  const isFree = !plan || plan.pricePaise <= 0 || plan.planType === 'FREE';
  const saving = bundleSaving(plan?.pricePaise ?? 0, cards.map((c) => c.pricingPlans[0]?.pricePaise ?? 0));
  const currency = plan?.currency ?? 'INR';
  const thumbnail = bundle.thumbnailAssetId ?? cards[0]?.course?.thumbnailAssetId ?? null;

  return (
    <div className="mx-auto max-w-[80rem] px-4 py-8 sm:px-6 sm:py-10">
      {plan && (
        <TrackEvent
          event={{ name: 'view_item', currency: plan.currency, items: [{ id: product.id, name: product.title, pricePaise: plan.pricePaise }] }}
        />
      )}
      <p className="t-small faint">
        <Link href="/courses" className="underline">All courses</Link> · Bundle
      </p>

      <div className="mt-3 grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0">
          <h1 className="t-display">{product.title}</h1>
          {bundle.description && <p className="t-lead mt-3 max-w-prose">{bundle.description}</p>}

          <div className="mt-6 overflow-hidden rounded-[var(--radius)] border">
            <CourseMedia title={product.title} assetId={thumbnail} priority ratio="aspect-video" fit="natural" />
          </div>

          <section className="mt-8" aria-labelledby="inside">
            <p className="t-eyebrow">What is inside</p>
            <h2 id="inside" className="t-heading mt-1">
              {cards.length} courses, in the order to take them
            </h2>
            <ol className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {cards.map((c, i) => (
                <li key={c.id} className="relative">
                  <span
                    className="absolute left-2 top-2 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold"
                    style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
                  >
                    {i + 1}
                  </span>
                  <CourseCard card={c} rating={ratings.get(c.id)} />
                </li>
              ))}
            </ol>
          </section>
        </div>

        <aside className="lg:sticky lg:top-[7.5rem] lg:self-start">
          <div className="rounded-[var(--radius)] border bg-[var(--surface)] p-5 shadow-sm">
            {isFree || !plan ? (
              <p className="t-price">{plan ? 'Free' : 'Price on enquiry'}</p>
            ) : (
              <div>
                <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                  <span className="t-price">{formatMoney(plan.pricePaise, plan.currency)}</span>
                  {saving.savingPaise > 0 && (
                    <span className="t-small faint line-through tabular-nums">{formatMoney(saving.separatelyPaise, plan.currency)}</span>
                  )}
                </div>
                {saving.savingPaise > 0 ? (
                  <p className="t-small mt-1 font-semibold" style={{ color: 'var(--ok)' }}>
                    Save {formatMoney(saving.savingPaise, plan.currency)} ({saving.savingPercent}%) against buying the {cards.length} courses one by one
                  </p>
                ) : (
                  <p className="t-small faint mt-1">One payment for all {cards.length} courses.</p>
                )}
                {plan.instalmentCount > 1 && <p className="t-small faint mt-1">Or {plan.instalmentCount} instalments.</p>}
                {plan.validityDays ? <p className="t-small faint mt-1">Access for {plan.validityDays} days from purchase.</p> : null}
              </div>
            )}

            <div className="mt-4">
              <CourseCta
                productId={product.id}
                isPaid={!isFree}
                pricingPlanId={plan?.id}
                pricePaise={plan?.pricePaise ?? 0}
                currency={currency}
                learnHref="/learn"
                continueLabel="Go to your courses"
                fullWidth
              />
            </div>
            {!isFree && plan && (
              <div className="mt-2.5">
                <AddToCart
                  productId={product.id}
                  pricingPlanId={plan.id}
                  fullWidth
                  item={{ id: product.id, name: product.title, pricePaise: plan.pricePaise }}
                  currency={plan.currency}
                />
              </div>
            )}
            <p className="t-small faint mt-2.5 text-center">
              Buying the bundle enrols you in every course inside. Secure checkout; a coupon can be applied before you pay.
            </p>
          </div>

          <ul className="t-small muted mt-4 space-y-1.5">
            {cards.map((c) => (
              <li key={c.id} className="flex items-baseline justify-between gap-3">
                <Link href={`/course/${c.slug}`} className="underline-offset-2 hover:underline">
                  {c.title}
                </Link>
                <span className="faint tabular-nums">
                  {c.pricingPlans[0] ? formatMoney(c.pricingPlans[0].pricePaise, c.pricingPlans[0].currency) : ''}
                </span>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}
