import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { getSiteContext } from '@/lib/site';
import { formatMoney } from '@/lib/money';
import { MATERIAL_LABELS, formatDuration } from '@/lib/progress';
import { Badge, LinkButton } from '@/components/ui';
import { NoTenantNotice } from '@/components/tenant-notices';
import { EnrolButton } from './enrol-button';
import { Curriculum } from './curriculum';

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
          accessAfterCompletion: true,
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

  const description =
    found.course.description?.slice(0, 155) ??
    `${found.product.title} at ${found.site.organization.name}.`;

  return {
    title: `${found.product.title} — ${found.site.organization.name}`,
    description,
    alternates: { canonical: `/course/${found.product.slug}` },
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
  const user = await getSessionUser();

  const plan = product.pricingPlans[0];
  const isFree = !plan || plan.pricePaise === 0;

  const [enrollment, instructors] = await Promise.all([
    user
      ? db.enrollment.findFirst({
          where: { userId: user.id, productId: product.id, status: { notIn: ['CANCELLED', 'ARCHIVED'] } },
          select: { id: true },
        })
      : Promise.resolve(null),
    // Named only where a trainer is actually assigned to a running batch.
    db.user.findMany({
      where: {
        id: { in: course.batches.flatMap((b) => b.staff.map((s) => s.userId)) },
      },
      select: { id: true, name: true },
    }),
  ]);

  const lessons = course.modules.flatMap((m) => m.module.sections.flatMap((s) => s.materials));
  const totalSeconds = lessons.reduce((n, l) => n + (l.durationSeconds ?? 0), 0);
  const preview = lessons.find((l) => l.isFreePreview);

  const outcomes = Array.isArray(course.overviewBlocks)
    ? (course.overviewBlocks as { heading?: string; body?: string }[]).filter((b) => b.heading || b.body)
    : [];

  const format =
    course.batches.length > 0 ? (lessons.length > 0 ? 'Blended' : 'Live') : 'Recorded';

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

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="border-b bg-[var(--surface-2)]">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <nav aria-label="Breadcrumb" className="t-small faint">
            <Link href="/courses" className="hover:underline">
              Courses
            </Link>
            {course.categories[0] && (
              <>
                {' / '}
                <Link href={`/courses/${course.categories[0].category.slug}`} className="hover:underline">
                  {course.categories[0].category.name}
                </Link>
              </>
            )}
          </nav>

          <h1 className="mt-2 max-w-3xl text-3xl font-semibold leading-tight tracking-tight">
            {product.title}
          </h1>

          {course.description && (
            <p className="muted mt-3 max-w-2xl leading-relaxed">{course.description}</p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Badge tone="brand">{format}</Badge>
            {course.level && <Badge tone="neutral">Level {course.level}</Badge>}
            {course.language && <Badge tone="neutral">{course.language}</Badge>}
            {lessons.length > 0 && (
              <Badge tone="neutral">
                {lessons.length} lesson{lessons.length === 1 ? '' : 's'}
              </Badge>
            )}
            {totalSeconds > 0 && <Badge tone="neutral">{formatDuration(totalSeconds)}</Badge>}
          </div>
        </div>
      </div>

      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-10 pb-24 lg:pb-0">
          {outcomes.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold">What this course covers</h2>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {outcomes.map((o, i) => (
                  <li key={i} className="flex gap-2.5">
                    <span aria-hidden className="mt-0.5 shrink-0" style={{ color: 'var(--brand)' }}>
                      ✓
                    </span>
                    <span className="t-small">
                      {o.heading && <strong className="block font-medium">{o.heading}</strong>}
                      {o.body && <span className="muted">{o.body}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h2 className="text-lg font-semibold">Curriculum</h2>
              <p className="t-small faint">
                {course.modules.length} module{course.modules.length === 1 ? '' : 's'} ·{' '}
                {lessons.length} lesson{lessons.length === 1 ? '' : 's'}
              </p>
            </div>
            <div className="mt-4">
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
            </div>
          </section>

          {course.batches.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold">Upcoming batches</h2>
              <p className="t-small muted mt-1">
                Timings come from the live class schedule, so these are the batches actually running.
              </p>
              <ul className="mt-4 divide-y rounded-[var(--radius)] border bg-[var(--surface)]">
                {course.batches.map((b) => {
                  const seatsLeft = b.capacity ? b.capacity - b._count.enrollments : null;
                  return (
                    <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                      <div>
                        <p className="text-sm font-medium">{b.name}</p>
                        <p className="t-small faint">
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
                        {seatsLeft !== null && seatsLeft > 0 && (
                          <span className="t-small faint tabular-nums">{seatsLeft} seats left</span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {instructors.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold">
                {instructors.length === 1 ? 'Your trainer' : 'Your trainers'}
              </h2>
              <ul className="mt-4 flex flex-wrap gap-3">
                {instructors.map((i) => (
                  <li
                    key={i.id}
                    className="flex items-center gap-3 rounded-[var(--radius)] border bg-[var(--surface)] px-4 py-3"
                  >
                    <span
                      aria-hidden
                      className="grid h-9 w-9 place-items-center rounded-full text-sm font-semibold text-[var(--brand-ink)]"
                      style={{ background: 'var(--brand)' }}
                    >
                      {i.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="text-sm font-medium">{i.name}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h2 className="text-lg font-semibold">Before you enrol</h2>
            <dl className="mt-4 divide-y rounded-[var(--radius)] border bg-[var(--surface)]">
              <Row label="Format">
                {format === 'Blended'
                  ? 'Live classes with a trainer, plus recorded material you work through yourself.'
                  : format === 'Live'
                    ? 'Live classes with a trainer on a scheduled weekly pattern.'
                    : 'Recorded lessons you work through in your own time.'}
              </Row>
              <Row label="Teaching language">{course.language ?? 'Confirmed at enrolment'}</Row>
              <Row label="Level">{course.level ?? 'Open to all levels'}</Row>
              <Row label="Access period">
                {plan?.validityDays
                  ? `${plan.validityDays} days from the day you enrol`
                  : 'No expiry stated for this course'}
              </Row>
              <Row label="Taxes">
                Prices are shown before tax. Applicable GST is added at checkout and shown on your
                invoice.
              </Row>
              <Row label="Cancellation and refunds">
                <>
                  As set out on the{' '}
                  <Link href="/policies/refund" className="underline">
                    refunds and cancellation page
                  </Link>
                  .
                </>
              </Row>
            </dl>
          </section>
        </div>

        {/* Purchase card. Sticky on desktop, a bar at the bottom on a phone, and
            the bar never covers the content because the column reserves space. */}
        <aside className="hidden lg:block">
          <div className="sticky top-24 rounded-[var(--radius)] border bg-[var(--surface)] p-6 shadow-sm">
            <PriceBlock plan={plan} isFree={isFree} />

            <div className="mt-5">
              {enrollment ? (
                <LinkButton href={`/learn/${product.id}`} className="w-full justify-center" size="lg">
                  Continue learning
                </LinkButton>
              ) : (
                <EnrolButton
                  productId={product.id}
                  signedIn={Boolean(user)}
                  isPaid={!isFree}
                  pricingPlanId={plan?.id}
                  pricePaise={plan?.pricePaise ?? 0}
                  currency={plan?.currency ?? 'INR'}
                  fullWidth
                />
              )}
            </div>

            {preview && (
              <Link href="/sample" className="t-small mt-3 block text-center underline">
                Watch a free lesson first
              </Link>
            )}

            <ul className="t-small muted mt-5 space-y-2 border-t pt-5">
              {lessons.length > 0 && (
                <li>
                  {lessons.length} lesson{lessons.length === 1 ? '' : 's'}
                  {totalSeconds > 0 ? `, ${formatDuration(totalSeconds)} of material` : ''}
                </li>
              )}
              {course.batches.length > 0 && <li>Live classes with attendance recorded</li>}
              {course.batches.length > 0 && <li>Recordings of classes published to your batch</li>}
              <li>Progress saved across devices</li>
              {course.accessAfterCompletion && <li>Access continues after you finish</li>}
            </ul>
          </div>
        </aside>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-[var(--surface)] p-3 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] lg:hidden">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <PriceBlock plan={plan} isFree={isFree} compact />
          </div>
          {enrollment ? (
            <LinkButton href={`/learn/${product.id}`}>Continue</LinkButton>
          ) : (
            <EnrolButton
              productId={product.id}
              signedIn={Boolean(user)}
              isPaid={!isFree}
              pricingPlanId={plan?.id}
              pricePaise={plan?.pricePaise ?? 0}
              currency={plan?.currency ?? 'INR'}
            />
          )}
        </div>
      </div>
    </>
  );
}

function PriceBlock({
  plan,
  isFree,
  compact = false,
}: {
  plan?: {
    pricePaise: number;
    mrpPaise: number | null;
    currency: string;
    instalmentCount: number;
  };
  isFree: boolean;
  compact?: boolean;
}) {
  if (isFree || !plan) {
    return <p className={compact ? 'text-lg font-semibold' : 'text-2xl font-semibold'}>Free</p>;
  }

  return (
    <div>
      <p className={`font-semibold tabular-nums ${compact ? 'text-lg' : 'text-3xl'}`}>
        {formatMoney(plan.pricePaise, plan.currency)}
        {plan.mrpPaise && plan.mrpPaise > plan.pricePaise && (
          <span className="t-small faint ml-2 font-normal line-through">
            {formatMoney(plan.mrpPaise, plan.currency)}
          </span>
        )}
      </p>
      <p className="t-micro faint">
        plus applicable taxes
        {plan.instalmentCount > 1 ? ` · ${plan.instalmentCount} instalments available` : ''}
      </p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 px-5 py-4 sm:grid-cols-[180px_1fr] sm:gap-4">
      <dt className="t-small font-medium">{label}</dt>
      <dd className="t-small muted">{children}</dd>
    </div>
  );
}
