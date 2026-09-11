import Link from 'next/link';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { Badge, Card, EmptyState, LinkButton, ProgressRing, Section } from '@/components/ui';
import { CourseMedia } from '@/components/course-media';
import { JoinButton } from './join-button';
import { RateClass } from './rate-class';
import { Banners } from '@/components/banners';
import { Leaderboard } from '@/components/leaderboard';
import { questionsOf } from '@/lib/feedback';
import { dayKey, formatDayLabel, formatTime } from '@/lib/clock';
import { assessmentsForLearner } from '@/lib/assessment-access';
import { feeNoticeFor } from '@/lib/dues';
import { TrackEvent } from '@/components/track-event';

export const dynamic = 'force-dynamic';

export default async function MyLearning({
  searchParams,
}: {
  searchParams?: Promise<{ welcome?: string }>;
}) {
  const { welcome } = (await searchParams) ?? {};
  const tenant = await requireTenant();
  const user = await getSessionUser();
  if (!user) return null;

  const enrollments = await db.enrollment.findMany({
    where: {
      userId: user.id,
      organizationId: tenant.organizationId,
      status: { notIn: ['CANCELLED', 'ARCHIVED'] },
    },
    orderBy: [{ lastActivityAt: 'desc' }, { createdAt: 'desc' }],
    include: {
      product: { select: { id: true, title: true, course: { select: { thumbnailAssetId: true } } } },
      batch: { select: { name: true } },
    },
  });

  // Classes today for the batches this learner is in. This is the reason most
  // people open the app at all, so it goes above everything else.
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const batchIds = enrollments.map((e) => e.batchId).filter((id): id is string => Boolean(id));

  const todayClasses = batchIds.length
    ? await db.liveSession.findMany({
        where: {
          organizationId: tenant.organizationId,
          batchId: { in: batchIds },
          startsAt: { gte: dayStart, lt: dayEnd },
          status: { not: 'CANCELLED' },
        },
        orderBy: { startsAt: 'asc' },
        include: { batch: { select: { name: true } } },
      })
    : [];

  const now = new Date();

  // A fee that is due is said once, at the top, with the amount. Nobody
  // should find out from the office that they are three weeks late.
  const openInstalments = await db.instalment.findMany({
    where: { enrollment: { organizationId: tenant.organizationId, userId: user.id }, paidAt: null },
    select: { amountPaise: true, paidPaise: true, dueDate: true },
  });
  const feeNotice = feeNoticeFor(openInstalments, now, tenant.currency);

  // Classes worth asking about: sat in the last week, finished, not yet rated.
  // Asked here rather than by email, because this is where the learner already is.
  const feedbackForm = await db.feedbackForm.findFirst({
    where: { organizationId: tenant.organizationId, type: 'SESSION', isActive: true },
    orderBy: { createdAt: 'desc' },
    select: { id: true, questions: true },
  });

  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);

  const toRate =
    feedbackForm && batchIds.length
      ? await db.liveSession.findMany({
          where: {
            organizationId: tenant.organizationId,
            batchId: { in: batchIds },
            status: { not: 'CANCELLED' },
            endsAt: { gte: weekAgo, lte: now },
            attendances: { some: { userId: user.id, status: { in: ['PRESENT', 'LATE'] } } },
            feedback: { none: { userId: user.id, formId: feedbackForm.id } },
          },
          orderBy: { startsAt: 'desc' },
          take: 5,
          select: { id: true, title: true, startsAt: true },
        })
      : [];

  const inProgress = enrollments.filter((e) => e.progressPercent > 0 && e.progressPercent < 100);
  const notStarted = enrollments.filter((e) => e.progressPercent === 0);
  const done = enrollments.filter((e) => e.progressPercent >= 100);
  const resume = inProgress[0];

  // Targeted at a batch they are in, or at everyone. Nothing else.
  const announcements = await db.announcement.findMany({
    where: {
      organizationId: tenant.organizationId,
      publishAt: { lte: new Date() },
      targets: {
        some: { OR: [{ batchId: { in: batchIds } }, { batchId: null }] },
      },
    },
    orderBy: { publishAt: 'desc' },
    take: 5,
    select: { id: true, title: true, bodyHtml: true, urgency: true, publishAt: true },
  });

  /*
   * Tests the academy set for this learner personally, rather than through a
   * course. Without this they exist and are reachable only by a link nobody
   * sends, which is the same as not existing.
   */
  const allTests = await assessmentsForLearner({
    organizationId: tenant.organizationId,
    userId: user.id,
  });
  const extraTests = allTests.filter((t) => t.via !== 'COURSE');

  const certificates = await db.issuedCertificate.findMany({
    where: { userId: user.id, revokedAt: null },
    orderBy: { issuedAt: 'desc' },
    select: {
      id: true,
      serialNo: true,
      issuedAt: true,
      verifyToken: true,
      enrollment: { select: { product: { select: { title: true } } } },
    },
  });

  return (
    <div className="mx-auto max-w-5xl px-5 py-7">
      <div className="space-y-8">
      <div>
        <h1 className="t-display">My learning</h1>
        <p className="t-small muted mt-1">
          {enrollments.length === 0
            ? `Hello, ${user.name.split(' ')[0]}. Nothing on your shelf yet.`
            : `Hello, ${user.name.split(' ')[0]}. ${enrollments.length} course${enrollments.length === 1 ? '' : 's'} on your shelf.`}
        </p>
        {enrollments.length > 0 && (
          <nav aria-label="Sections" className="rail -mx-5 mt-4 flex gap-1 border-b px-5">
            {[
              ['#in-progress', 'In progress', inProgress.length],
              ['#not-started', 'Not started', notStarted.length],
              ['#completed', 'Completed', done.length],
              ['#certificates', 'Certificates', certificates.length],
            ]
              .filter(([, , n]) => (n as number) > 0)
              .map(([href, label, n]) => (
                <a key={href as string} href={href as string} className="shrink-0 border-b-2 border-transparent px-3 py-2 text-sm font-medium text-[var(--ink-2)] hover:border-[var(--brand)] hover:text-[var(--ink)]">
                  {label} <span className="faint tabular-nums">{n as number}</span>
                </a>
              ))}
          </nav>
        )}
      </div>

      <Banners organizationId={tenant.organizationId} placement="LEARNER_HOME" />
      {welcome && (
        <TrackEvent once={`signup:${user.id}`} event={{ name: 'sign_up', eventId: `signup:${user.id}`, method: 'form' }} />
      )}

      {feeNotice && (
        <Link
          href="/learn/fees"
          className={`mb-6 flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius)] border px-4 py-3 text-sm ${
            feeNotice.overdue ? 'border-[var(--bad)] bg-[var(--bad-soft)]' : 'border-[var(--warn)] bg-[var(--warn-soft)]'
          }`}
        >
          <span className="font-medium">{feeNotice.text}</span>
          <span className="underline">Pay now</span>
        </Link>
      )}

      {extraTests.length > 0 && (
        <Section title="Set for you">
          <Card padded={false}>
            <ul className="divide-y">
              {extraTests.map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/learn/assessment/${t.id}`}
                    className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-[var(--surface-2)]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{t.title}</span>
                      <span className="t-small faint">
                        {t.kind.toLowerCase().replace('_', ' ')}
                        {t.via === 'POOL' ? ' · from your practice set' : ' · added by the academy'}
                      </span>
                    </span>
                    <Badge>open</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </Section>
      )}

      {todayClasses.length > 0 && (
        <Section title="Today">
          <Card padded={false}>
            <ul className="divide-y">
              {todayClasses.map((s) => {
                const live = s.startsAt <= now && s.endsAt >= now;
                const soon = !live && s.startsAt > now;
                return (
                  <li key={s.id} className="flex flex-wrap items-center gap-4 px-5 py-3">
                    <span className="w-20 shrink-0 tabular-nums">
                      {s.startsAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="t-body font-medium">{s.title}</p>
                      <p className="t-small faint truncate">
                        {s.batch?.name ?? 'One to one class'}
                      </p>
                    </div>
                    {live && <Badge tone="ok">live now</Badge>}
                    {soon && <Badge>upcoming</Badge>}
                    <JoinButton sessionId={s.id} live={live} />
                  </li>
                );
              })}
            </ul>
          </Card>
        </Section>
      )}

      {feedbackForm && toRate.length > 0 && (
        <RateClass
          formId={feedbackForm.id}
          questions={questionsOf(feedbackForm.questions)}
          sessions={toRate.map((s) => ({
            id: s.id,
            title: s.title,
            when: `${formatDayLabel(dayKey(s.startsAt, tenant.timezone), tenant.timezone)}, ${formatTime(s.startsAt, tenant.timezone)}`,
          }))}
        />
      )}

      <Leaderboard
        organizationId={tenant.organizationId}
        userId={user.id}
        batchIds={batchIds}
        productIds={enrollments.map((e) => e.productId)}
      />

      {resume && (
        <Card className="flex flex-wrap items-center gap-5 border-[var(--brand-line)] bg-[var(--brand-soft)]">
          <ProgressRing value={resume.progressPercent} size={52} />
          <div className="min-w-0 flex-1">
            <p className="t-micro faint">Pick up where you left off</p>
            <p className="t-title mt-0.5 truncate">{resume.product.title}</p>
          </div>
          <LinkButton href={`/learn/${resume.productId}`}>Continue</LinkButton>
        </Card>
      )}

      {enrollments.length === 0 && (
        <EmptyState
          title="You are not enrolled in anything yet"
          hint="Browse the catalogue and enrol to get started."
          action={<LinkButton href="/">Explore courses</LinkButton>}
        />
      )}

      {inProgress.length > 0 && (
        <div id="in-progress" className="scroll-mt-20">
          <Section title="Continue learning">
            <CourseGrid items={inProgress} cta="Continue" />
          </Section>
        </div>
      )}

      {notStarted.length > 0 && (
        <div id="not-started" className="scroll-mt-20">
          <Section title="Not started">
            <CourseGrid items={notStarted} cta="Start" />
          </Section>
        </div>
      )}

      {announcements.length > 0 && (
        <Section title="Notices">
          <ul className="space-y-2">
            {announcements.map((a) => (
              <li
                key={a.id}
                className="rounded-[var(--radius)] border bg-[var(--surface)] p-4"
                style={
                  a.urgency === 'HIGH'
                    ? { borderColor: 'var(--warn)', background: 'var(--warn-soft)' }
                    : undefined
                }
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium">{a.title}</p>
                  <span className="t-small faint">
                    {a.publishAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  </span>
                </div>
                <p className="t-small muted mt-1 whitespace-pre-wrap">{a.bodyHtml}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {done.length > 0 && (
        <div id="completed" className="scroll-mt-20">
          <Section title="Completed">
            <CourseGrid items={done} cta="Revisit" />
          </Section>
        </div>
      )}

      {certificates.length > 0 && (
        <div id="certificates" className="scroll-mt-20">
        <Section title="Certificates">
          <ul className="divide-y rounded-[var(--radius)] border bg-[var(--surface)]">
            {certificates.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {c.enrollment?.product.title ?? 'Certificate'}
                  </p>
                  <p className="t-small faint font-mono">
                    {c.serialNo} ·{' '}
                    {c.issuedAt.toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </p>
                </div>
                <a
                  href={`/verify/${c.verifyToken}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex h-9 shrink-0 items-center rounded-[var(--radius-sm)] border bg-[var(--surface)] px-3.5 text-sm font-medium"
                >
                  Open and share
                </a>
              </li>
            ))}
          </ul>
          <p className="t-small faint mt-2">
            That link is the certificate. Anyone can open it to check it is real, and it shows
            nothing about you beyond your name, the course and the date.
          </p>
        </Section>
        </div>
      )}
      </div>
    </div>
  );
}

function CourseGrid({
  items,
  cta,
}: {
  items: {
    id: string;
    productId: string;
    progressPercent: number;
    expiresAt: Date | null;
    product: { title: string; course: { thumbnailAssetId: string | null } | null };
    batch: { name: string } | null;
  }[];
  cta: string;
}) {
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((e) => {
        const pct = Math.round(e.progressPercent);
        return (
          <Link
            key={e.id}
            href={`/learn/${e.productId}`}
            className="group flex flex-col overflow-hidden rounded-[var(--radius)] border bg-[var(--surface)] shadow-sm transition hover:shadow"
          >
            <CourseMedia title={e.product.title} assetId={e.product.course?.thumbnailAssetId} ratio="aspect-video" />
            <div className="flex flex-1 flex-col p-4">
              <p className="text-[0.9375rem] font-bold leading-snug line-clamp-2 group-hover:text-[var(--brand)]">{e.product.title}</p>
              <p className="t-small faint mt-1 truncate">
                {e.batch?.name ?? 'Self-paced'}
                {e.expiresAt
                  ? ` · until ${e.expiresAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
                  : ''}
              </p>
              <div className="mt-auto pt-4">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--brand)' }} />
                </div>
                <div className="mt-1.5 flex items-center justify-between">
                  <span className="t-small faint tabular-nums">{pct === 0 ? 'Not started' : pct >= 100 ? 'Completed' : `${pct}% complete`}</span>
                  <span className="t-small font-semibold" style={{ color: 'var(--brand)' }}>
                    {cta} →
                  </span>
                </div>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
