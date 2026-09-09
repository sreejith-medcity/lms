import Link from 'next/link';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { Badge, Card, EmptyState, LinkButton, ProgressRing, Section } from '@/components/ui';
import { JoinButton } from './join-button';
import { RateClass } from './rate-class';
import { Banners } from '@/components/banners';
import { questionsOf } from '@/lib/feedback';
import { dayKey, formatDayLabel, formatTime } from '@/lib/clock';

export const dynamic = 'force-dynamic';

export default async function MyLearning() {
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
      product: { select: { id: true, title: true } },
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
          batchId: { in: batchIds },
          startsAt: { gte: dayStart, lt: dayEnd },
          status: { not: 'CANCELLED' },
        },
        orderBy: { startsAt: 'asc' },
        include: { batch: { select: { name: true } } },
      })
    : [];

  const now = new Date();

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
        <h1 className="t-display">Hello, {user.name.split(' ')[0]}</h1>
        <p className="t-small muted mt-1">
          {enrollments.length === 0
            ? 'Nothing on your shelf yet.'
            : `${enrollments.length} course${enrollments.length === 1 ? '' : 's'} on your shelf.`}
        </p>
      </div>

      <Banners organizationId={tenant.organizationId} placement="LEARNER_HOME" />

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
                      <p className="t-small faint truncate">{s.batch.name}</p>
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

      {notStarted.length > 0 && (
        <Section title="Not started">
          <CourseGrid items={notStarted} cta="Start" />
        </Section>
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

      {inProgress.length > 0 && (
        <Section title="In progress">
          <CourseGrid items={inProgress} cta="Continue" />
        </Section>
      )}

      {done.length > 0 && (
        <Section title="Completed">
          <CourseGrid items={done} cta="Revisit" />
        </Section>
      )}

      {certificates.length > 0 && (
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
    product: { title: string };
    batch: { name: string } | null;
  }[];
  cta: string;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {items.map((e) => (
        <Link
          key={e.id}
          href={`/learn/${e.productId}`}
          className="group rounded-[var(--radius)] border bg-[var(--surface)] p-5 shadow-sm transition hover:border-[var(--brand-line)] hover:shadow"
        >
          <div className="flex items-start gap-4">
            <ProgressRing value={e.progressPercent} />
            <div className="min-w-0 flex-1">
              <p className="t-heading truncate">{e.product.title}</p>
              {e.batch && <p className="t-small faint truncate">{e.batch.name}</p>}
              {e.expiresAt && (
                <p className="t-small faint mt-1">
                  Access until {e.expiresAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </p>
              )}
            </div>
          </div>
          <p className="t-small mt-4 font-medium" style={{ color: 'var(--brand)' }}>
            {cta} →
          </p>
        </Link>
      ))}
    </div>
  );
}
