import Link from 'next/link';
import type { Metadata } from 'next';
import { db } from '@/lib/db';
import { getTenantState } from '@/lib/tenant';
import { getSiteContext, courseCardSelect, ratingsFor, type CourseCard as Card } from '@/lib/site';
import { CourseCard } from '@/components/course-card';
import { Rail } from '@/components/course-rail';
import { SetupNotice, NoTenantNotice } from '@/components/tenant-notices';
import { settingBool, settingText } from '@/lib/settings/store';
import { SubjectCard } from '@/components/subject-card';
import { HomeHero } from './home-hero';
import { Banners } from '@/components/banners';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const site = await getSiteContext();
  if (!site) return { title: 'Learning platform' };
  const name = site.organization.name;
  return {
    title: `${name} — courses, live classes and exam preparation`,
    description: `Enrol in ${name} courses with live classes, recorded lessons and structured practice. Track your progress from one place.`,
    alternates: { canonical: '/' },
    openGraph: { title: name, type: 'website' },
  };
}

export default async function Home() {
  const state = await getTenantState();
  if (state.status === 'setup-required') return <SetupNotice detail={state.detail} />;
  if (state.status === 'no-tenant') return <NoTenantNotice />;

  const site = await getSiteContext();
  if (!site) return <NoTenantNotice />;

  const org = site.organization;

  const hero = Promise.all([
    settingText(site.organizationId, 'website.heroEyebrow'),
    settingText(site.organizationId, 'website.heroTitle'),
    settingText(site.organizationId, 'website.heroHighlight'),
    settingText(site.organizationId, 'website.heroBlurb'),
    settingText(site.organizationId, 'website.heroImageAssetId'),
    settingText(site.organizationId, 'website.googleRating'),
    settingText(site.organizationId, 'website.googleReviewCount'),
    settingText(site.organizationId, 'website.reviewBadgeHtml'),
    settingBool(site.organizationId, 'website.reviewBadgeOnLight'),
  ]);

  // The two counts that fed the hero's counter row are gone with it. They were
  // a product count and a session count run on every home page view to print
  // numbers that are now not printed.
  const [popular, recent, samples, testimonials] = await Promise.all([
    // Marked courses first, and only marked courses once there are any. An
    // academy that has chosen eight to push should not have a ninth appear
    // underneath them just because the row had space; before anything is
    // marked, the newest stand in so the page is never empty.
    db.product.findMany({
      where: {
        organizationId: site.organizationId,
        type: 'COURSE',
        status: 'PUBLISHED',
        deletedAt: null,
        isFeatured: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: courseCardSelect,
    }),
    db.product.findMany({
      where: { organizationId: site.organizationId, type: 'COURSE', status: 'PUBLISHED', deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: courseCardSelect,
    }),
    // The sample lesson button only appears if there is a real lesson behind it.
    db.material.findFirst({
      where: {
        isFreePreview: true,
        section: { module: { organizationId: site.organizationId } },
      },
      select: { id: true },
    }),
    db.testimonial.findMany({
      where: { organizationId: site.organizationId, isPublished: true },
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: { id: true, authorName: true, rating: true, comment: true },
    }),
  ]);

  const popularOnly = popular.length > 0;
  const cards = (popularOnly ? popular : recent) as unknown as Card[];

  // A rail per subject, for the subjects with enough behind them to fill
  // one. Three at most on the home page; the catalogue has the rest.
  const railSubjects = site.homeCategories.filter((c) => c._count.courses >= 3).slice(0, 3);
  const subjectRails = await Promise.all(
    railSubjects.map(async (c) => ({
      category: c,
      cards: (await db.product.findMany({
        where: {
          organizationId: site.organizationId,
          type: 'COURSE',
          status: 'PUBLISHED',
          deletedAt: null,
          isAddonOnly: false,
          course: { categories: { some: { category: { slug: c.slug } } } },
        },
        orderBy: [{ isFeatured: 'desc' }, { createdAt: 'desc' }],
        take: 10,
        select: courseCardSelect,
      })) as unknown as Card[],
    })),
  );

  const ratings = await ratingsFor(site.organizationId, [
    ...cards.map((c) => c.id),
    ...subjectRails.flatMap((r) => r.cards.map((c) => c.id)),
  ]);

  const [
    heroEyebrow,
    heroTitle,
    heroHighlight,
    heroBlurb,
    heroImage,
    googleRating,
    googleCount,
    reviewBadgeHtml,
    reviewBadgeOnLight,
  ] = await hero;

  const google =
    googleRating.trim() && googleCount.trim()
      ? { rating: googleRating.trim(), reviewCount: googleCount.trim() }
      : undefined;

  return (
    <>
      <HomeHero
        eyebrow={heroEyebrow.trim() || org.name}
        title={heroTitle.trim()}
        highlight={heroHighlight.trim()}
        blurb={heroBlurb.trim()}
        imageAssetId={heroImage.trim() || null}
        google={google ?? null}
        badgeHtml={reviewBadgeHtml}
        badgeOnLight={reviewBadgeOnLight}
        sampleId={samples?.id ?? null}
      />

      <div className="mx-auto max-w-[80rem] px-4 sm:px-6">
        <Banners organizationId={site.organizationId} placement="SITE_HOME" className="mb-2" />
      </div>

      {/* The subjects as a row of chips, right under the hero, so the first
          thing after "what is this place" is "where do I go". */}
      {site.homeCategories.length > 0 && (
        <nav aria-label="Subjects" className="mx-auto max-w-[80rem] px-4 pt-8 sm:px-6">
          <div className="rail -mx-4 flex gap-2 px-4 sm:mx-0 sm:flex-wrap sm:px-0">
            {site.homeCategories.map((c) => (
              <Link
                key={c.slug}
                href={`/courses/${c.slug}`}
                className="whitespace-nowrap rounded-full border px-4 py-2 text-sm font-medium transition hover:border-[var(--brand)] hover:text-[var(--brand)]"
              >
                {c.name}
              </Link>
            ))}
          </div>
        </nav>
      )}

      {/* The courses come first. Somebody arriving on a storefront wants to
          see what is actually for sale before anything else. */}
      <RailSection
        title={popularOnly ? 'Popular courses' : 'Newest courses'}
        description="Prices are before applicable taxes. Batch dates come from the live schedule."
        action={{ href: '/courses', label: 'All courses' }}
      >
        {cards.length === 0 ? (
          <div className="rounded-[var(--radius)] border border-dashed bg-[var(--surface)] p-10 text-center">
            <p className="t-heading">No courses published yet</p>
            <p className="t-small muted mx-auto mt-1 max-w-sm">
              Courses appear here the moment they are published from the admin.
            </p>
          </div>
        ) : (
          <Rail ariaLabel="Popular courses">
            {cards.map((c, i) => (
              <CourseCard key={c.id} card={c} rating={ratings.get(c.id)} google={google} priority={i < 4} compact />
            ))}
          </Rail>
        )}
      </RailSection>

      {subjectRails.map((rail) => (
        <RailSection
          key={rail.category.slug}
          title={`${rail.category.name} courses`}
          description={rail.category.tagline ?? undefined}
          action={{ href: `/courses/${rail.category.slug}`, label: `All ${rail.category.name}` }}
        >
          <Rail ariaLabel={`${rail.category.name} courses`}>
            {rail.cards.map((c) => (
              <CourseCard key={c.id} card={c} rating={ratings.get(c.id)} google={google} compact />
            ))}
          </Rail>
        </RailSection>
      ))}

      {site.homeCategories.length > 0 && (
        <section className="mx-auto max-w-[80rem] px-4 py-10 sm:px-6 sm:py-14">
          <h2 className="t-section">Top subjects</h2>
          <p className="t-lead muted mt-2 max-w-2xl">
            Pick the subject you are here for. Every course inside it has its own dates, price
            and curriculum.
          </p>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:mt-7 sm:gap-4 lg:grid-cols-3 xl:grid-cols-5">
            {site.homeCategories.map((c, i) => (
              <SubjectCard key={c.slug} subject={c} google={google} priority={i < 5} />
            ))}
          </div>
        </section>
      )}

      <Formats />

      <Section
        title="What happens after you enrol"
        description="Everything below is how this platform already works, not a roadmap."
      >
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Feature
            title="Pick up where you left off"
            body="Your place in a course is saved as you go and follows you to any device you sign in on."
          />
          <Feature
            title="Classes on your calendar"
            body="Live sessions show up on your dashboard the day they run, with a join button that opens the class."
          />
          <Feature
            title="Attendance without a register"
            body="Joining a class marks you present. Nobody has to remember to sign anyone in."
          />
          <Feature
            title="Recordings for the class you missed"
            body="A recording published for your batch appears on your course page, ready to play and seek."
          />
        </div>
      </Section>

      <Journey />

      {testimonials.length > 0 && (
        <Section title="What learners say">
          <div className="grid gap-4 md:grid-cols-3">
            {testimonials.map((t) => (
              <figure key={t.id} className="rounded-[var(--radius)] border bg-[var(--surface)] p-5 shadow-sm">
                <blockquote className="text-sm leading-relaxed">{t.comment}</blockquote>
                <figcaption className="t-small faint mt-3">{t.authorName}</figcaption>
              </figure>
            ))}
          </div>
        </Section>
      )}

      <Faq supportEmail={org.supportEmail} />

      <section className="mx-auto max-w-[80rem] px-4 pb-4 sm:px-6">
        <div
          className="flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius-lg)] px-6 py-8 text-[var(--shell-ink)] sm:px-10"
          style={{ background: 'var(--shell)' }}
        >
          <div>
            <h2 className="text-xl font-bold sm:text-2xl">Not sure which course is right for you?</h2>
            <p className="mt-1 text-sm text-[var(--shell-muted)]">
              A counsellor will call you back, look at where you are, and say plainly what to do next.
            </p>
          </div>
          <Link
            href="/contact"
            className="inline-flex h-11 items-center rounded-[var(--radius-sm)] px-5 text-sm font-semibold"
            style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
          >
            Talk to a counsellor
          </Link>
        </div>
      </section>
    </>
  );
}

/* Sections ---------------------------------------------------------------- */

function RailSection({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <section className="mx-auto max-w-[80rem] px-4 py-8 sm:px-6 sm:py-10">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight sm:text-2xl">{title}</h2>
          {description && <p className="t-small muted mt-1 max-w-prose">{description}</p>}
        </div>
        {action && (
          <Link href={action.href} className="t-small font-semibold hover:underline" style={{ color: 'var(--brand)' }}>
            {action.label} →
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
          {description && <p className="t-small muted mt-1 max-w-prose">{description}</p>}
        </div>
        {action && (
          <Link href={action.href} className="t-small font-medium hover:underline" style={{ color: 'var(--brand)' }}>
            {action.label} →
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-[var(--radius)] border bg-[var(--surface)] p-5 shadow-sm">
      <p className="text-sm font-semibold">{title}</p>
      <p className="t-small muted mt-1.5 leading-relaxed">{body}</p>
    </div>
  );
}

function Formats() {
  const formats = [
    {
      name: 'Live',
      body: 'Scheduled classes with a trainer, on a fixed weekly pattern. You join from your dashboard and your attendance is recorded when you do.',
    },
    {
      name: 'Recorded',
      body: 'Lessons you work through in your own time. Your position is saved, so a ten minute gap between shifts is enough to make progress.',
    },
    {
      name: 'Blended',
      body: 'Both. Live classes for the parts that need a teacher, recorded material for drilling, revision and anything you missed.',
    },
  ];

  return (
    <section className="border-y bg-[var(--surface-2)]">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <h2 className="text-xl font-semibold tracking-tight">Three ways a course can run</h2>
        <p className="t-small muted mt-1 max-w-prose">
          Every course page says which of these it uses, so you know what you are signing up for.
        </p>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {formats.map((f) => (
            <div key={f.name} className="rounded-[var(--radius)] border bg-[var(--surface)] p-5">
              <p className="text-sm font-semibold">{f.name}</p>
              <p className="t-small muted mt-1.5 leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Journey() {
  const steps = [
    ['Choose a course', 'Compare format, level, duration, batch dates and price on the course page.'],
    ['Create your account', 'One account, used for every course you take here.'],
    ['Enrol', 'You are placed in a batch and your access period starts.'],
    ['Start learning', 'Your dashboard opens on the next thing to do.'],
  ];

  return (
    <Section title="From choosing a course to your first class">
      <ol className="grid gap-4 md:grid-cols-4">
        {steps.map(([title, body], i) => (
          <li key={title} className="rounded-[var(--radius)] border bg-[var(--surface)] p-5 shadow-sm">
            <span
              className="grid h-7 w-7 place-items-center rounded-full text-xs font-semibold text-[var(--brand-ink)]"
              style={{ background: 'var(--brand)' }}
            >
              {i + 1}
            </span>
            <p className="mt-3 text-sm font-semibold">{title}</p>
            <p className="t-small muted mt-1 leading-relaxed">{body}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}

function Faq({ supportEmail }: { supportEmail: string | null }) {
  const items: [string, React.ReactNode][] = [
    [
      'How long do I keep access to a course?',
      'Each course page states its access period. Where a course has one, it starts when you enrol, and it is shown on the pricing before you pay.',
    ],
    [
      'What happens if I miss a live class?',
      'Recordings published for your batch appear on your course page. Your attendance record shows which classes you joined.',
    ],
    [
      'Can I study from my phone?',
      'Yes. Every screen here is built for a phone first, and your progress follows you between devices.',
    ],
    [
      'How do refunds work?',
      <>
        The terms are on the{' '}
        <Link href="/policies/refund" className="underline">
          refunds and cancellation page
        </Link>
        , and they apply as written there.
      </>,
    ],
    [
      'I have a question that is not here.',
      supportEmail ? (
        <>
          Write to{' '}
          <a href={`mailto:${supportEmail}`} className="underline">
            {supportEmail}
          </a>{' '}
          or use the{' '}
          <Link href="/contact" className="underline">
            enquiry form
          </Link>
          .
        </>
      ) : (
        <>
          Use the{' '}
          <Link href="/contact" className="underline">
            enquiry form
          </Link>{' '}
          and someone will come back to you.
        </>
      ),
    ],
  ];

  return (
    <Section title="Common questions">
      <div className="divide-y rounded-[var(--radius)] border bg-[var(--surface)]">
        {items.map(([q, a]) => (
          <details key={q} className="group px-5 py-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium">
              {q}
              <span aria-hidden className="faint transition group-open:rotate-45">
                +
              </span>
            </summary>
            <p className="t-small muted mt-2 leading-relaxed">{a}</p>
          </details>
        ))}
      </div>
    </Section>
  );
}
