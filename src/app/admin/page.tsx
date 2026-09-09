import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { getSessionUser } from '@/lib/auth';
import { formatMoney } from '@/lib/money';
import { Stat, StatGrid } from '@/components/stat';
import { Card, EmptyState, LinkButton, ProgressRing, Section } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function AdminHome() {
  const tenant = await requireTenant();
  const user = await getSessionUser();
  const orgId = tenant.organizationId;

  const since = new Date();
  since.setDate(since.getDate() - 30);

  const [learners, courses, batches, enrolments, revenue, todaySessions, recent] = await Promise.all([
    db.user.count({ where: { organizationId: orgId, kind: 'LEARNER', deletedAt: null } }),
    db.product.count({ where: { organizationId: orgId, type: 'COURSE', deletedAt: null } }),
    db.batch.count({ where: { organizationId: orgId, status: { in: ['ACTIVE', 'UPCOMING'] } } }),
    db.enrollment.count({ where: { organizationId: orgId, createdAt: { gte: since } } }),
    db.payment.aggregate({
      where: { organizationId: orgId, status: 'CAPTURED', createdAt: { gte: since } },
      _sum: { amountPaise: true },
    }),
    db.liveSession.count({
      where: {
        organizationId: orgId,
        startsAt: { gte: startOfDay(), lt: endOfDay() },
        status: { not: 'CANCELLED' },
      },
    }),
    db.enrollment.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
      take: 6,
      include: {
        user: { select: { name: true } },
        product: { select: { title: true } },
      },
    }),
  ]);

  const firstName = user?.name.split(' ')[0] ?? 'there';

  return (
    <div className="space-y-7">
      <div>
        <h1 className="t-display">Good {partOfDay()}, {firstName}</h1>
        <p className="t-small muted mt-1">Here is where {tenant.name} stands today.</p>
      </div>

      <StatGrid>
        <Stat label="Learners" value={learners.toLocaleString('en-IN')} />
        <Stat label="Enrolments" value={enrolments} sub="last 30 days" />
        <Stat
          label="Revenue"
          value={formatMoney(revenue._sum.amountPaise ?? 0, tenant.currency)}
          sub="last 30 days"
        />
        <Stat label="Sessions today" value={todaySessions} />
      </StatGrid>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Section
            title="Recent enrolments"
            action={
              <LinkButton href="/admin/learners" variant="ghost" size="sm">
                All learners
              </LinkButton>
            }
          >
            {recent.length === 0 ? (
              <EmptyState
                title="No enrolments yet"
                hint="Publish a course and share the link, or enrol someone from the admin."
                action={
                  <LinkButton href="/admin/courses" size="sm">
                    Go to courses
                  </LinkButton>
                }
              />
            ) : (
              <Card padded={false}>
                <ul className="divide-y">
                  {recent.map((e) => (
                    <li key={e.id} className="flex items-center gap-4 px-5 py-3">
                      <ProgressRing value={e.progressPercent} size={36} />
                      <div className="min-w-0 flex-1">
                        <p className="t-body truncate font-medium">{e.user.name}</p>
                        <p className="t-small faint truncate">{e.product.title}</p>
                      </div>
                      <span className="t-small faint shrink-0">
                        {e.createdAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </Section>
        </div>

        <Section title="Catalogue">
          <Card className="space-y-4">
            <div className="flex items-baseline justify-between">
              <span className="t-small muted">Courses</span>
              <span className="text-xl font-semibold tabular-nums">{courses}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="t-small muted">Active batches</span>
              <span className="text-xl font-semibold tabular-nums">{batches}</span>
            </div>
            <LinkButton href="/admin/courses/new" className="w-full" size="sm">
              New course
            </LinkButton>
          </Card>
        </Section>
      </div>
    </div>
  );
}

function partOfDay() {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

function startOfDay() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay() {
  const d = startOfDay();
  d.setDate(d.getDate() + 1);
  return d;
}
