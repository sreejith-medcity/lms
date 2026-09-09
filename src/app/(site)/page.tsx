import Link from 'next/link';
import type { Metadata } from 'next';
import { db } from '@/lib/db';
import { getTenantState } from '@/lib/tenant';
import { getSiteContext, courseCardSelect, type CourseCard as Card } from '@/lib/site';
import { CourseCard } from '@/components/course-card';
import { SetupNotice, NoTenantNotice } from '@/components/tenant-notices';
import { HomeSearch } from './home-search';

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

  const [featured, all, samples, testimonials, published] = await Promise.all([
    db.product.findMany({
      where: { organizationId: site.organizationId, type: 'COURSE', status: 'PUBLISHED', deletedAt: null },
      orderBy: [{ isFeatured: 'desc' }, { createdAt: 'desc' }],
      take: 6,
      select: courseCardSelect,
    }),
    db.product.count({
      where: { organizationId: site.organizationId, type: 'COURSE', status: 'PUBLISHED', deletedAt: null },
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
    db.liveSession.count({
      where: {
        organizationId: site.organizationId,
        startsAt: { gte: new Date() },
        status: { not: 'CANCELLED' },
      },
    }),
  ]);

  const cards = featured as unknown as Card[];

  return (
    <>
      <Hero
        name={org.name}
        courseCount={all}
        upcomingSessions={published}
        sampleId={samples?.id ?? null}
      />

      {site.categories.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 pb-4 sm:px-6">
          <div className="flex flex-wrap gap-2">
            {site.categories.map((c) => (
              <Link
                key={c.slug}
                href={`/courses/${c.slug}`}
                className="rounded-full border bg-[var(--surface)] px-4 py-2 text-sm transition
                  hover:border-[var(--brand)] hover:text-[var(--brand)]"
              >
                {c.name}
                <span className="t-micro faint ml-2 tabular-nums">{c._count.courses}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <Section
        title="Courses"
        description="Prices are what you pay before applicable taxes. Batch dates come from the live schedule."
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
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {cards.map((c) => (
              <CourseCard key={c.id} card={c} />
            ))}
          </div>
        )}
      </Section>

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
    </>
  );
}

/* Sections ---------------------------------------------------------------- */

function Hero({
  name,
  courseCount,
  upcomingSessions,
  sampleId,
}: {
  name: string;
  courseCount: number;
  upcomingSessions: number;
  sampleId: string | null;
}) {
  return (
    <section className="relative overflow-hidden border-b">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-40 h-80 opacity-[0.07] blur-3xl"
        style={{ background: 'var(--brand)' }}
      />
      <div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-24">
        <p className="t-small font-medium" style={{ color: 'var(--brand)' }}>
          {name}
        </p>
        <h1 className="mt-3 max-w-3xl text-4xl font-semibold leading-[1.1] tracking-tight md:text-5xl">
          Learn a language, clear the exam, get to work.
        </h1>
        <p className="muted mt-4 max-w-2xl text-base leading-relaxed md:text-lg">
          Structured courses with live classes, recorded lessons and practice you can
          actually schedule around a job. One place for your batch, your material and
          your progress.
        </p>

        <div className="mt-7 flex flex-wrap items-center gap-3">
          <Link
            href="/courses"
            className="inline-flex h-11 items-center rounded-[var(--radius-sm)] px-5 text-sm font-medium text-[var(--brand-ink)]"
            style={{ background: 'var(--brand)' }}
          >
            Explore courses
          </Link>
          {sampleId && (
            <Link
              href="/sample"
              className="inline-flex h-11 items-center rounded-[var(--radius-sm)] border bg-[var(--surface)] px-5 text-sm font-medium"
            >
              Try a sample lesson
            </Link>
          )}
        </div>

        <div className="mt-8 max-w-md">
          <HomeSearch />
        </div>

        <dl className="mt-10 flex flex-wrap gap-x-10 gap-y-4">
          <Fact label="Courses published" value={courseCount} />
          <Fact label="Classes scheduled ahead" value={upcomingSessions} />
        </dl>
      </div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="t-micro faint uppercase tracking-wide">{label}</dt>
      <dd className="mt-0.5 text-2xl font-semibold tabular-nums">{value}</dd>
    </div>
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
