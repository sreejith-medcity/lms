import Link from 'next/link';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { Card, EmptyState, LinkButton, ProgressRing, Section } from '@/components/ui';

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

  const inProgress = enrollments.filter((e) => e.progressPercent > 0 && e.progressPercent < 100);
  const notStarted = enrollments.filter((e) => e.progressPercent === 0);
  const done = enrollments.filter((e) => e.progressPercent >= 100);
  const resume = inProgress[0];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="t-display">Hello, {user.name.split(' ')[0]}</h1>
        <p className="t-small muted mt-1">
          {enrollments.length === 0
            ? 'Nothing on your shelf yet.'
            : `${enrollments.length} course${enrollments.length === 1 ? '' : 's'} on your shelf.`}
        </p>
      </div>

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
