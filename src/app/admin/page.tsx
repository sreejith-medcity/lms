import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { Stat } from '@/components/stat';
import { formatMoney } from '@/lib/money';

export const dynamic = 'force-dynamic';

export default async function AdminHome() {
  const tenant = await requireTenant();
  const orgId = tenant.organizationId;

  const since = new Date();
  since.setDate(since.getDate() - 30);

  const [learners, courses, batches, enrolments, revenue, todaySessions] = await Promise.all([
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
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Welcome {tenant.name}</h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Stat label="Learners" value={learners.toLocaleString('en-IN')} />
        <Stat label="Courses" value={courses} />
        <Stat label="Active batches" value={batches} />
        <Stat label="Enrolments" value={enrolments} sub="last 30 days" />
        <Stat
          label="Revenue"
          value={formatMoney(revenue._sum.amountPaise ?? 0, tenant.currency)}
          sub="last 30 days"
        />
        <Stat label="Sessions today" value={todaySessions} />
      </div>
    </div>
  );
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
