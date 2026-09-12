import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { languageName } from '@/lib/language';
import { getSiteContext } from '@/lib/site';
import { formatMoney } from '@/lib/money';
import { MATERIAL_LABELS, formatDuration } from '@/lib/progress';
import { Badge } from '@/components/ui';
import { CourseMedia } from '@/components/course-media';
import { Rating } from '@/components/rating';
import { NoTenantNotice } from '@/components/tenant-notices';
import { addonsFor } from '@/lib/addons';
import { settingText } from '@/lib/settings/store';
import { GoogleBadge, ReviewWidget } from '@/components/review-badge';
import { AddonPicker } from './addon-picker';
import { AddToCart } from '@/components/add-to-cart';
import { TrackEvent } from '@/components/track-event';
import { PageBlocks } from '@/components/page-blocks';
import { parseBlocks } from '@/lib/page-blocks';
import { CourseCta } from './course-cta';
import { Curriculum } from './curriculum';
import { EnrolBar } from './enrol-bar';
import { SectionNav } from './section-nav';

export const dynamic = 'force-dynamic';

async function load(slug: string) {
  const site = await getSiteContext();
  if (!site) return null;

  const product = await db.product.findFirst({
    where: {
      organizationId: site.organizationId,
      slug,
      type: 'COURSE',
      status: 'PUBLISHED',
      // An add-on has no page of its own: it is a tick box on a course.
      isAddonOnly: false,
      deletedAt: null,
    },
    select: {
      id: true,
      title: true,
      slug: true,
      course: {
        select: {
          id: true,
          description: true,
          overviewBlocks: true,
          level: true,
          language: true,
          durationMinutes: true,
          thumbnailAssetId: true,
          accessAfterCompletion: true,
          /* The marketing page this course was sold from before, if it was
             brought across. Its words go on this page and its old path is
             where the page answers, so the links in circulation keep working. */
          landingPage: {
            select: {
              slug: true,
              status: true,
              blocks: true,
              seoTitle: true,
              seoDescription: true,
            },
          },
          categories: { select: { category: { select: { name: true, slug: true } } } },
          modules: {
            orderBy: { sortOrder: 'asc' },
            select: {
              module: {
                select: {
                  id: true,
                  name: true,
                  description: true,
                  sections: {
                    orderBy: { sortOrder: 'asc' },
                    select: {
                      id: true,
                      title: true,
                      materials: {
                        orderBy: { sortOrder: 'asc' },
                        select: {
                          id: true,
                          title: true,
                          type: true,
                          durationSeconds: true,
                          isFreePreview: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          batches: {
            where: { status: { in: ['UPCOMING', 'ACTIVE'] }, deletedAt: null },
            orderBy: { startDate: 'asc' },
            take: 4,
            select: {
              id: true,
              name: true,
              startDate: true,
              endDate: true,
              capacity: true,
              status: true,
              branch: { select: { name: true, city: true } },
              staff: { where: { role: 'PRIMARY_TUTOR' }, select: { userId: true } },
              _count: { select: { enrollments: true } },
            },
          },
        },
      },
      pricingPlans: {
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          name: true,
          pricePaise: true,
          mrpPaise: true,
          currency: true,
          validityDays: true,
          instalmentCount: true,
        },
      },
      testimonials: {
        where: { isPublished: true },
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: { id: true, authorName: true, rating: true, comment: true, createdAt: true },
      },
    },
  });

  if (!product?.course) return null;
  return { site, product, course: product.course };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const found = await load((await params).slug);
  if (!found) return { title: 'Course not found' };

  const landing =
    found.course.landingPage?.status === 'PUBLISHED' ? found.course.landingPage : null;

  const description =
    landing?.seoDescription ??
    found.course.description?.slice(0, 155) ??
    `${found.product.title} at ${found.site.organization.name}.`;

  const title = landing?.seoTitle ?? `${found.product.title} — ${found.site.organization.name}`;

  return {
    title,
    description,
    /* One address for one page. Where a course kept its old marketing URL,
       that is the one search engines were told about for years, so it stays
       the canonical one and /course/<slug> points at it. */
    alternates: { canonical: landing ? `/${landing.slug}` : `/course/${found.product.slug}` },
    openGraph: { title: found.product.title, description, type: 'website' },
  };
}

export default async function CoursePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const found = await load(slug);
  if (!found) {
    const site = await getSiteContext();
    if (!site) return <NoTenantNotice />;
    notFound();
  }

  const { site, product, course } = found;
  const plan = product.pricingPlans[0];
  const isFree = !plan || plan.pricePaise === 0;
  const category = course.categories[0]?.category;

  // Nothing on this page depends on who is looking. Whether they are enrolled,
  // whether they are signed in and what their points are worth are all fetched
  // by the call to action after the page has arrived, which is what lets a
  // cache hold the page at all. Adding a single server-side session read here
  // would quietly make every course page uncacheable again.
  // Started before the queries below rather than after them, so three cached
  // setting reads do not cost a round trip of their own.
  const siteBits = Promise.all([
    settingText(site.organizationId, 'website.googleRating'),
    settingText(site.organizationId, 'website.googleReviewCount'),
    settingText(site.organizationId, 'website.reviewWidgetHtml'),
  ]);

  const [instructors, related, addons] = await Promise.all([
    // Named only where a trainer is actually assigned to a running batch.
    db.user.findMany({
      where: { id: { in: course.batches.flatMap((b) => b.staff.map((s) => s.userId)) } },
      select: {
        id: true,
        name: true,
        instructorProfile: {
          select: { headline: true, bio: true, expertise: true, hideNameOnCards: true },
        },
      },
    }),
    category
      ? db.product.findMany({
          where: {
            organizationId: site.organizationId,
            type: 'COURSE',
            status: 'PUBLISHED',
            deletedAt: null,
            id: { not: product.id },
            isAddonOnly: false,
            course: { categories: { some: { category: { slug: category.slug } } } },
          },
          orderBy: [{ isFeatured: 'desc' }, { createdAt: 'desc' }],
          take: 3,
          select: {
            id: true,
            title: true,
            slug: true,
            course: { select: { thumbnailAssetId: true, level: true } },
            pricingPlans: {
              where: { isActive: true },
              orderBy: { sortOrder: 'asc' },
              take: 1,
              select: { pricePaise: true, currency: true },
            },
          },
        })
      : Promise.resolve([]),
    addonsFor(site.organizationId, product.id),
  ]);

  const [googleRating, googleCount, reviewWidgetHtml] = await siteBits;
  const hasReviewWidget = reviewWidgetHtml.trim().length > 0;

  // A trainer may ask not to be named publicly, and that is theirs to decide.
  const shownInstructors = instructors.filter((i) => !i.instructorProfile?.hideNameOnCards);

  const lessons = course.modules.flatMap((m) => m.module.sections.flatMap((s) => s.materials));
  const totalSeconds = lessons.reduce((n, l) => n + (l.durationSeconds ?? 0), 0);
  const preview = lessons.find((l) => l.isFreePreview);

  const landingBlocks =
    course.landingPage?.status === 'PUBLISHED' ? parseBlocks(course.landingPage.blocks) : [];

  const landingHeading =
    landingBlocks[0] && 'heading' in landingBlocks[0] ? landingBlocks[0].heading : undefined;
  const landingBody = landingHeading
    ? [{ ...landingBlocks[0], heading: undefined }, ...landingBlocks.slice(1)]
    : landingBlocks;

  const outcomes = Array.isArray(course.overviewBlocks)
    ? (course.overviewBlocks as { heading?: string; body?: string }[]).filter(
        (b) => b.heading || b.body,
      )
    : [];

  const format = course.batches.length > 0 ? (lessons.length > 0 ? 'Blended' : 'Live') : 'Recorded';
  const saving =
    plan?.mrpPaise && plan.mrpPaise > plan.pricePaise
      ? Math.round(((plan.mrpPaise - plan.pricePaise) / plan.mrpPaise) * 100)
      : null;

  const reviews = product.testimonials.filter((t) => t.comment);
  const ratingCount = product.testimonials.length;
  const ratingAverage = ratingCount
    ? Math.round((product.testimonials.reduce((n, t) => n + t.rating, 0) / ratingCount) * 10) / 10
    : null;

  // The four facts that decide whether somebody keeps reading, each one read
  // from the course rather than written by hand.
  const facts = [
    { label: 'Format', value: format },
    {
      label: 'Course length',
      value:
        totalSeconds > 0
          ? formatDuration(totalSeconds)
          : course.durationMinutes
            ? `${Math.round(course.durationMinutes / 60)} hours`
            : 'Set by your batch',
    },
    { label: 'Level', value: course.level ?? 'Open to all' },
    {
      label: 'Access',
      value: plan?.validityDays
        ? `${plan.validityDays} days`
        : course.accessAfterCompletion
          ? 'Keeps working after you finish'
          : 'For the length of the course',
    },
  ];

  const heroPoints = [
    course.batches.length > 0 ? 'Live classes with a trainer, on a published schedule' : null,
    lessons.length > 0
      ? `${lessons.length} recorded lesson${lessons.length === 1 ? '' : 's'} you can rewatch as often as you like`
      : null,
    course.batches.length > 0 ? 'Recordings published to your batch, so a missed class is not a lost class' : null,
    'Progress saved across every device you sign in on',
    'Certificate on completion',
  ].filter((p): p is string => Boolean(p));

  const navItems = [
    { id: 'overview', label: 'Overview' },
    outcomes.length > 0 ? { id: 'outcomes', label: 'What you learn' } : null,
    landingBlocks.length > 0 ? { id: 'about', label: 'About the course' } : null,
    { id: 'curriculum', label: 'Curriculum' },
    course.batches.length > 0 ? { id: 'batches', label: 'Batches' } : null,
    shownInstructors.length > 0 ? { id: 'trainers', label: 'Trainers' } : null,
    reviews.length > 0 || hasReviewWidget ? { id: 'reviews', label: 'Reviews' } : null,
    { id: 'faq', label: 'Before you enrol' },
  ].filter((i): i is { id: string; label: string } => Boolean(i));

  // Structured data describes only what is visible on this page.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Course',
    name: product.title,
    description: course.description ?? undefined,
    provider: { '@type': 'Organization', name: site.organization.name },
    inLanguage: course.language ?? undefined,
    educationalLevel: course.level ?? undefined,
    hasCourseInstance: course.batches.map((b) => ({
      '@type': 'CourseInstance',
      courseMode: format === 'Recorded' ? 'online' : 'blended',
      startDate: b.startDate?.toISOString().slice(0, 10),
      endDate: b.endDate?.toISOString().slice(0, 10),
    })),
    ...(ratingAverage
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: ratingAverage,
            reviewCount: ratingCount,
          },
        }
      : {}),
    ...(plan
      ? {
          offers: {
            '@type': 'Offer',
            price: (plan.pricePaise / 100).toFixed(2),
            priceCurrency: plan.currency,
            category: 'Paid',
          },
        }
      : {}),
  };

  const purchase = (
    <>
      <GoogleBadge rating={googleRating.trim()} reviewCount={googleCount.trim()} className="mb-3" />

      <PriceBlock plan={plan} isFree={isFree} saving={saving} />

      {addons.length > 0 && (
        <AddonPicker
          productId={product.id}
          className="mt-4"
          options={addons.map((a) => ({
            productId: a.productId,
            label: a.label,
            note: a.note,
            priceLabel: a.priceLabel,
            isPreselected: a.isPreselected,
          }))}
        />
      )}

      <div className="mt-4">
        <CourseCta
          productId={product.id}
          isPaid={!isFree}
          pricingPlanId={plan?.id}
          pricePaise={plan?.pricePaise ?? 0}
          currency={plan?.currency ?? 'INR'}
          learnHref={`/learn/${product.id}`}
          fullWidth
        />
      </div>

      {/* Buying two courses at once is normal for this academy: German and
          IELTS together, a course and its question bank. Enrol now is still
          the first button, because most people are here for one thing. */}
      {!isFree && (
        <div className="mt-2.5">
          <AddToCart
            productId={product.id}
            pricingPlanId={plan?.id}
            fullWidth
            item={plan ? { id: product.id, name: product.title, pricePaise: plan.pricePaise, category: category?.name } : undefined}
            currency={plan?.currency}
          />
        </div>
      )}

      <p className="t-small faint mt-2.5 text-center">
        Secure checkout. A coupon can be applied before you pay.
      </p>

      {preview && (
        <Link
          href="/sample"
          className="t-small mt-3 flex items-center justify-center gap-1.5 underline"
          style={{ color: 'var(--brand)' }}
        >
          Watch a free lesson first
        </Link>
      )}

    </>
  );

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      {!isFree && plan && (
        <TrackEvent
          event={{
            name: 'view_item',
            currency: plan.currency,
            items: [{ id: product.id, name: product.title, pricePaise: plan.pricePaise, category: category?.name }],
          }}
        />
      )}

      {/* Hero ------------------------------------------------------------- */}
      {/*
        One grid for the whole page, three cells.

        The hero and the sections are the left column, the purchase card is the
        right one and it spans both rows, which is what lets it stay with the
        reader the whole way down. Sticky inside the hero band only worked
        until the band ended, about a screen in.

        The DOM order is hero, card, sections, so a phone stacks them in
        exactly the order somebody wants them: read what it is, see what it
        costs, then the curriculum. No ordering tricks, and nothing that
        depends on a magic number of pixels.
      */}
      {/* The clip is out here, on the full-width wrapper, because a 100vw
          bleed inside the constrained container would be clipped by the
          container itself and the band would stop at the text. */}
      <div className="overflow-x-clip">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="relative isolate lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-x-12">
            {/* The dark band behind the hero, bled to the window edges from
                inside a constrained container so it passes behind the card.
                On a desktop it is a grid item across both columns of the
                first row, which is exactly the hero's height. */}
            <div aria-hidden className="relative -z-10 hidden lg:col-start-1 lg:col-end-3 lg:row-start-1 lg:block">
              <span className="absolute inset-y-0 left-1/2 w-screen -translate-x-1/2" style={{ background: 'var(--shell)' }} />
            </div>
          <section className="relative isolate pb-8 pt-6 text-[var(--shell-ink)] sm:pb-10 lg:col-start-1 lg:row-start-1">
            <span
              aria-hidden
              className="absolute inset-y-0 left-1/2 -z-10 w-screen -translate-x-1/2 lg:hidden"
              style={{ background: 'var(--shell)' }}
            />

          <nav aria-label="Breadcrumb" className="t-small text-[var(--shell-muted)]">
            <Link href="/courses" className="hover:underline">
              Courses
            </Link>
            {category && (
              <>
                <span className="px-1.5">/</span>
                <Link href={`/courses/${category.slug}`} className="hover:underline">
                  {category.name}
                </Link>
              </>
            )}
          </nav>

          <div className="mt-5">
            <div>
              <h1 className="max-w-2xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl">{product.title}</h1>

              {course.description && (
                <p className="mt-3 max-w-2xl text-base leading-relaxed text-[var(--shell-muted)] sm:text-lg">{course.description}</p>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                {ratingAverage !== null && (
                  <Rating average={ratingAverage} count={ratingCount} className="[&_span]:text-[var(--shell-ink)]" />
                )}
                <span className="rounded-[3px] px-1.5 py-0.5 text-xs font-bold" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>
                  {format}
                </span>
                {languageName(course.language) && <span className="text-[var(--shell-muted)]">Taught in {languageName(course.language)}</span>}
              </div>

              <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-3">
                {facts.map((f) => (
                  <div key={f.label}>
                    <dt className="text-xs text-[var(--shell-muted)]">{f.label}</dt>
                    <dd className="mt-0.5 text-sm font-semibold leading-snug">{f.value}</dd>
                  </div>
                ))}
              </dl>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap lg:hidden">
                <a
                  href="#enrol"
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-[var(--radius-sm)] px-6 text-sm font-semibold transition hover:brightness-105"
                  style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
                >
                  Enrol now
                  <span aria-hidden>→</span>
                </a>
              </div>

              <ul className="mt-6 grid gap-x-6 gap-y-2 border-t border-[var(--shell-line)] pt-5 sm:grid-cols-2">
                {heroPoints.map((p) => (
                  <li key={p} className="flex items-start gap-2 text-sm text-[var(--shell-muted)]">
                    <Check light />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </div>

          </div>
          </section>

          <aside
            id="enrol"
            aria-label="Enrol in this course"
            className="relative z-10 -mt-4 pb-2 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-0 lg:pt-6"
          >
            {/* The height cap is the guard for a short laptop screen: a card
                taller than the window would pin its top and put the buy
                button permanently out of reach. */}
            <div className="lg:sticky lg:top-[7.75rem] lg:max-h-[calc(100vh-8.5rem)] lg:overflow-y-auto lg:overscroll-contain">
              <div className="overflow-hidden rounded-[var(--radius-lg)] border bg-[var(--surface)] shadow-[var(--shadow)]">
                <div className="hidden lg:block">
                  <CourseMedia title={product.title} assetId={course.thumbnailAssetId} priority fit="natural" ratio="aspect-video" />
                </div>
                <div className="p-5 sm:p-6">{purchase}</div>
              </div>
            </div>
            {/* What the bar at the bottom of a phone watches for. */}
            <span id="enrol-anchor" aria-hidden className="block h-px" />
          </aside>

          <div className="pb-28 lg:col-start-1 lg:row-start-2 lg:pb-16">
            <SectionNav items={navItems} />

            <div className="space-y-12 pt-8">
          {/* Overview ----------------------------------------------------- */}
          <Section id="overview" eyebrow="Course overview" title="What this course is">
            <div className="grid gap-6 sm:grid-cols-[minmax(0,40rem)_minmax(0,17rem)] sm:justify-start">
              <p className="t-lead muted leading-relaxed">
                {course.description ??
                  `${product.title} at ${site.organization.name}. Full details are published as the curriculum is finalised.`}
              </p>
              <div
                className="rounded-[var(--radius)] border p-4"
                style={{ background: 'var(--brand-soft)', borderColor: 'var(--brand-line)' }}
              >
                <p className="t-small muted">One place for everything</p>
                <p className="t-small mt-1 font-medium leading-relaxed">
                  Classes, recordings, notes, tests and your certificate all live in the same
                  account. Nothing to download, nothing emailed separately.
                </p>
              </div>
            </div>
          </Section>

          {/* Outcomes ----------------------------------------------------- */}
          {outcomes.length > 0 && (
            <Section
              id="outcomes"
              eyebrow="Learning outcomes"
              title="What you will be able to do"
            >
              <ol className="grid gap-x-6 gap-y-3 rounded-[var(--radius)] border bg-[var(--surface)] p-5 sm:grid-cols-2 sm:p-6">
                {outcomes.map((o, i) => (
                  <li
                    key={i}
                    className="flex gap-3"
                  >
                    <Check />
                    <span className="min-w-0">
                      {o.heading && <strong className="block text-sm font-semibold">{o.heading}</strong>}
                      {o.body && <span className="t-small muted mt-0.5 block leading-relaxed">{o.body}</span>}
                    </span>
                  </li>
                ))}
              </ol>
            </Section>
          )}

          {/* The page this course used to be sold from ------------------- */}
          {landingBlocks.length > 0 && (
            /* The page brought over usually opens with its own heading, and
               printing ours above it reads as a stutter. Where it has one, it
               becomes the section's heading rather than a second one. */
            <Section
              id="about"
              eyebrow="About the course"
              title={landingHeading ?? `More about ${product.title}`}
            >
              <PageBlocks blocks={landingBody} ctaHref="#enrol" />
            </Section>
          )}

          {/* Curriculum --------------------------------------------------- */}
          <Section
            id="curriculum"
            eyebrow="Curriculum"
            title="Everything inside the course"
            aside={
              <p className="t-small faint">
                {course.modules.length} module{course.modules.length === 1 ? '' : 's'} ·{' '}
                {lessons.length} lesson{lessons.length === 1 ? '' : 's'}
                {totalSeconds > 0 ? ` · ${formatDuration(totalSeconds)}` : ''}
              </p>
            }
          >
            <Curriculum
              modules={course.modules.map((m) => ({
                id: m.module.id,
                name: m.module.name,
                sections: m.module.sections.map((s) => ({
                  id: s.id,
                  title: s.title,
                  materials: s.materials.map((mat) => ({
                    id: mat.id,
                    title: mat.title,
                    typeLabel: MATERIAL_LABELS[mat.type] ?? mat.type,
                    duration: mat.durationSeconds ? formatDuration(mat.durationSeconds) : null,
                    isFreePreview: mat.isFreePreview,
                  })),
                })),
              }))}
            />
          </Section>

          {/* Batches ------------------------------------------------------ */}
          {course.batches.length > 0 && (
            <Section id="batches" eyebrow="Live schedule" title="Batches you can join">
              <p className="t-small muted -mt-1 mb-4">
                Timings come from the live class schedule. A batch that has already started is
                still open where there are seats, and you get the recordings of the classes you
                missed.
              </p>
              <ul className="divide-y overflow-hidden rounded-[var(--radius)] border bg-[var(--surface)]">
                {course.batches.map((b) => {
                  const seatsLeft = b.capacity ? b.capacity - b._count.enrollments : null;
                  return (
                    <li
                      key={b.id}
                      className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
                    >
                      <div>
                        <p className="text-sm font-semibold">{b.name}</p>
                        <p className="t-small faint mt-0.5">
                          {b.branch.name}
                          {b.branch.city ? `, ${b.branch.city}` : ''}
                          {b.startDate
                            ? ` · starts ${b.startDate.toLocaleDateString('en-IN', {
                                day: 'numeric',
                                month: 'short',
                                year: 'numeric',
                              })}`
                            : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge tone={b.status === 'ACTIVE' ? 'ok' : 'neutral'}>
                          {b.status.toLowerCase()}
                        </Badge>
                        {seatsLeft !== null && (
                          <span className="t-small faint tabular-nums">
                            {seatsLeft > 0 ? `${seatsLeft} seats left` : 'Full, ask about the waiting list'}
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Section>
          )}

          {/* Trainers ----------------------------------------------------- */}
          {shownInstructors.length > 0 && (
            <Section
              id="trainers"
              eyebrow="Who teaches it"
              title={shownInstructors.length === 1 ? 'Your trainer' : 'Your trainers'}
            >
              <ul className="grid gap-3 sm:grid-cols-2">
                {shownInstructors.map((i) => (
                  <li
                    key={i.id}
                    className="flex items-start gap-3 rounded-[var(--radius)] border bg-[var(--surface)] p-4"
                  >
                    <span
                      aria-hidden
                      className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-bold text-[var(--brand-ink)]"
                      style={{ background: 'var(--brand)' }}
                    >
                      {i.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{i.name}</span>
                      {i.instructorProfile?.headline && (
                        <span className="t-small muted block">{i.instructorProfile.headline}</span>
                      )}
                      {i.instructorProfile?.bio && (
                        <span className="t-small faint mt-1.5 block leading-relaxed">
                          {i.instructorProfile.bio}
                        </span>
                      )}
                      {(i.instructorProfile?.expertise?.length ?? 0) > 0 && (
                        <span className="mt-2 flex flex-wrap gap-1.5">
                          {i.instructorProfile!.expertise.map((e) => (
                            <span
                              key={e}
                              className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[0.6875rem] font-medium text-[var(--ink-2)]"
                            >
                              {e}
                            </span>
                          ))}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* Reviews ------------------------------------------------------ */}
          {(reviews.length > 0 || hasReviewWidget) && (
            <Section id="reviews" eyebrow="Learner reviews" title="What learners say">
              {hasReviewWidget && <ReviewWidget html={reviewWidgetHtml} className="mb-5" />}
              <ul className="grid gap-3 sm:grid-cols-2">
                {reviews.map((r) => (
                  <li key={r.id} className="rounded-[var(--radius)] border bg-[var(--surface)] p-4">
                    <Rating average={r.rating} count={1} showCount={false} />
                    <p className="t-small mt-2.5 leading-relaxed">{r.comment}</p>
                    <p className="t-small faint mt-2.5">
                      {r.authorName} ·{' '}
                      {r.createdAt.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
                    </p>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* How enrolling works ------------------------------------------ */}
          <Section eyebrow="How it works" title="From here to your first class">
            <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ['Enrol', 'Pick your plan and pay. Cards, UPI and net banking all work.'],
                [
                  'Get your account',
                  'Access opens the moment payment clears. No waiting for somebody to add you.',
                ],
                [
                  course.batches.length > 0 ? 'Join your batch' : 'Start learning',
                  course.batches.length > 0
                    ? 'Your class schedule, your trainer and your recordings are all in one place.'
                    : 'Work through the lessons at your own pace. Progress is saved as you go.',
                ],
                ['Finish and certify', 'Your certificate is issued the moment you complete the course.'],
              ].map(([title, body], i) => (
                <li key={title} className="rounded-[var(--radius)] border bg-[var(--surface)] p-4">
                  <span
                    aria-hidden
                    className="grid h-7 w-7 place-items-center rounded-full text-[0.8125rem] font-bold"
                    style={{ background: 'var(--accent-soft)', color: 'var(--warn)' }}
                  >
                    {i + 1}
                  </span>
                  <strong className="mt-2.5 block text-sm font-semibold">{title}</strong>
                  <span className="t-small muted mt-1 block leading-relaxed">{body}</span>
                </li>
              ))}
            </ol>
          </Section>

          {/* Before you enrol --------------------------------------------- */}
          <Section id="faq" eyebrow="Before you enrol" title="The things people ask us first">
            <div className="max-w-3xl divide-y overflow-hidden rounded-[var(--radius)] border bg-[var(--surface)]">
              <Faq q="How is this course taught?" open>
                {format === 'Blended'
                  ? 'Live classes with a trainer, plus recorded material you work through yourself between classes.'
                  : format === 'Live'
                    ? 'Live classes with a trainer on a scheduled weekly pattern. Every class is recorded and published to your batch.'
                    : 'Recorded lessons you work through in your own time, in any order the curriculum allows.'}
              </Faq>
              <Faq q="What language is it taught in?">
                {languageName(course.language) ?? 'Confirmed with you at enrolment.'}
              </Faq>
              <Faq q="How long do I keep access?">
                {plan?.validityDays
                  ? `${plan.validityDays} days from the day you enrol.`
                  : course.accessAfterCompletion
                    ? 'Your access continues after you finish the course.'
                    : 'For the length of the course.'}
              </Faq>
              <Faq q="What does the price include, and is tax extra?">
                Prices are shown before tax. Applicable GST is added at checkout and appears on your
                invoice.
                {plan && plan.instalmentCount > 1
                  ? ` This course can also be paid in ${plan.instalmentCount} instalments.`
                  : ''}
              </Faq>
              <Faq q="Can I cancel or get a refund?">
                <>
                  Refunds and cancellations follow the{' '}
                  <Link href="/policies/refund" className="underline" style={{ color: 'var(--brand)' }}>
                    published policy
                  </Link>
                  , which sets out the window and how to ask.
                </>
              </Faq>
              <Faq q="Do I get a certificate?">
                Yes. It is issued automatically when you complete the course, and it carries a
                verification link anybody can check.
              </Faq>
            </div>
          </Section>

          {/* Related ------------------------------------------------------ */}
          {related.length > 0 && (
            <Section eyebrow="Also in this subject" title="Other courses you might want">
              <ul className="grid gap-3 sm:grid-cols-3">
                {related.map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`/course/${r.slug}`}
                      className="lift flex h-full flex-col overflow-hidden rounded-[var(--radius)] border bg-[var(--surface)]"
                    >
                      <CourseMedia
                        title={r.title}
                        assetId={r.course?.thumbnailAssetId}
                        ratio="aspect-[16/9]"
                      />
                      <span className="flex flex-1 flex-col p-4">
                        <span className="t-small font-semibold leading-snug">{r.title}</span>
                        <span className="t-small faint mt-auto pt-2">
                          {r.pricingPlans[0]
                            ? formatMoney(r.pricingPlans[0].pricePaise, r.pricingPlans[0].currency)
                            : 'Price on enquiry'}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* Closing band -------------------------------------------------- */}
          <section
            className="rounded-[var(--radius-lg)] p-7 sm:p-10"
            style={{ background: 'var(--shell)', color: 'var(--shell-ink)' }}
          >
            <p className="t-eyebrow" style={{ color: 'var(--accent)' }}>
              Ready when you are
            </p>
            <h2 className="t-section mt-2 max-w-xl">Start {product.title} at your own pace</h2>
            <p className="t-lead mt-3 max-w-xl" style={{ color: 'var(--shell-muted)' }}>
              Enrol online in a couple of minutes, or talk it through with an advisor first. Both
              get you to the same place.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a
                href="#enrol"
                className="inline-flex h-11 items-center gap-2 rounded-[var(--radius-sm)] px-6 text-sm font-semibold transition hover:brightness-105"
                style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
              >
                Enrol now
                <span aria-hidden>→</span>
              </a>
              <Link
                href="/contact"
                className="inline-flex h-11 items-center rounded-[var(--radius-sm)] border px-5 text-sm font-medium transition hover:bg-white/10"
                style={{ borderColor: 'var(--shell-line)', color: 'var(--shell-ink)' }}
              >
                Talk to an advisor
              </Link>
            </div>
          </section>
            </div>
          </div>
        </div>
      </div>
      </div>

      <EnrolBar>
        <div className="min-w-0">
          <PriceBlock plan={plan} isFree={isFree} saving={saving} compact />
        </div>
        <CourseCta
          productId={product.id}
          isPaid={!isFree}
          pricingPlanId={plan?.id}
          pricePaise={plan?.pricePaise ?? 0}
          currency={plan?.currency ?? 'INR'}
          learnHref={`/learn/${product.id}`}
          continueLabel="Continue"
        />
      </EnrolBar>
    </>
  );
}

/* Pieces ------------------------------------------------------------------ */

function Section({
  id,
  eyebrow,
  title,
  aside,
  children,
}: {
  id?: string;
  eyebrow: string;
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-32 lg:scroll-mt-40">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="t-eyebrow" style={{ color: 'var(--brand)' }}>
            {eyebrow}
          </p>
          <h2 className="t-section mt-1.5">{title}</h2>
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Faq({ q, open = false, children }: { q: string; open?: boolean; children: React.ReactNode }) {
  return (
    <details open={open} className="group">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-sm font-medium hover:bg-[var(--surface-2)]">
        {q}
        <span aria-hidden className="faint shrink-0 transition group-open:rotate-180">
          ⌄
        </span>
      </summary>
      <div className="t-small muted px-5 pb-4 leading-relaxed">{children}</div>
    </details>
  );
}

function PriceBlock({
  plan,
  isFree,
  saving,
  compact = false,
}: {
  plan?: {
    pricePaise: number;
    mrpPaise: number | null;
    currency: string;
    instalmentCount: number;
  };
  isFree: boolean;
  saving: number | null;
  compact?: boolean;
}) {
  if (isFree || !plan) {
    return <p className={compact ? 't-price-sticky' : 't-price'}>Free</p>;
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className={compact ? 't-price-sticky' : 't-price'}>
          {formatMoney(plan.pricePaise, plan.currency)}
        </span>
        {plan.mrpPaise && plan.mrpPaise > plan.pricePaise && (
          <span className="t-small faint line-through tabular-nums">
            {formatMoney(plan.mrpPaise, plan.currency)}
          </span>
        )}
        {saving && !compact && (
          <span
            className="t-small rounded-full px-2 py-0.5 font-semibold"
            style={{ background: 'var(--ok-soft)', color: 'var(--ok)' }}
          >
            Save {saving}%
          </span>
        )}
      </div>
      <p className="t-small faint mt-0.5">
        plus applicable taxes
        {plan.instalmentCount > 1 && !compact
          ? ` · ${plan.instalmentCount} instalments available`
          : ''}
      </p>
    </div>
  );
}

function Check({ light = false }: { light?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="mt-[0.2rem] h-3.5 w-3.5 shrink-0">
      <path
        d="M2 8.6l4 4L14 4"
        fill="none"
        stroke={light ? 'var(--accent)' : 'var(--brand)'}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
