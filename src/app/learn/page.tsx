import Link from 'next/link';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { Card, EmptyState } from '@/components/ui';

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
      product: { select: { id: true, title: true, course: { select: { description: true } } } },
      batch: { select: { name: true } },
    },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">My learning</h1>

      {enrollments.length === 0 ? (
        <EmptyState
          title="You are not enrolled in anything yet"
          hint="Browse the catalogue and enrol to get started."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {enrollments.map((e) => (
            <Card key={e.id}>
              <h2 className="font-medium">{e.product.title}</h2>
              {e.batch && <p className="text-xs text-slate-500">{e.batch.name}</p>}

              <div className="mt-4">
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${e.progressPercent}%`, background: 'var(--brand)' }}
                  />
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {Math.round(e.progressPercent)}% complete
                  {e.expiresAt && ` · access until ${e.expiresAt.toISOString().slice(0, 10)}`}
                </p>
              </div>

              <Link
                href={`/learn/${e.productId}`}
                className="mt-4 inline-flex rounded-lg px-3 py-2 text-sm font-medium text-white"
                style={{ background: 'var(--brand)' }}
              >
                {e.progressPercent > 0 ? 'Continue' : 'Start'}
              </Link>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
