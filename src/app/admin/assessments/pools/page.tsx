import Link from 'next/link';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { PoolEditor } from './editor';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * Sets of tests, sold or given as an allowance.
 *
 * A set is only a list; what a learner may take from it is decided on their
 * own page, one grant at a time. Keeping those apart is what lets the same
 * twenty mocks back an allowance of five for one candidate and ten for
 * another without duplicating anything.
 */
export default async function AssessmentPools({
  searchParams,
}: {
  searchParams: Promise<{ pool?: string }>;
}) {
  const tenant = await requireTenant();
  const me = await requireStaff('courses.assessments', 'view');
  const canEdit = me.permissions['courses.assessments']?.edit ?? false;

  const editing = (await searchParams).pool;

  const [pools, assessments] = await Promise.all([
    db.assessmentPool.findMany({
      where: { organizationId: tenant.organizationId },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        description: true,
        isActive: true,
        items: { select: { assessmentId: true } },
        _count: { select: { grants: true } },
      },
    }),
    db.assessment.findMany({
      where: { organizationId: tenant.organizationId, questions: { some: {} } },
      orderBy: { title: 'asc' },
      take: 300,
      select: { id: true, title: true, kind: true },
    }),
  ]);

  const current = pools.find((p) => p.id === editing);

  return (
    <div>
      <PageHeader
        title="Sets of tests"
        description="A set is a list of tests an allowance can be given over: any five of these twenty. Who may take how many is set on each learner's own page."
        action={
          <Link href="/admin/assessments" className="t-small underline">
            Back to tests
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <section>
          {pools.length === 0 ? (
            <EmptyState
              title="No sets yet"
              hint="Make one when you want to sell or give practice tests by the handful rather than one at a time."
            />
          ) : (
            <ul className="space-y-2">
              {pools.map((p) => (
                <li key={p.id}>
                  <Card>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link
                          href={`/admin/assessments/pools?pool=${p.id}`}
                          className="font-medium hover:underline"
                        >
                          {p.name}
                        </Link>
                        {p.description && <p className="t-small muted mt-1">{p.description}</p>}
                        <p className="t-small faint mt-1">
                          {p.items.length} test{p.items.length === 1 ? '' : 's'} ·{' '}
                          {p._count.grants} learner{p._count.grants === 1 ? '' : 's'} hold an
                          allowance
                        </p>
                      </div>
                      <Badge tone={p.isActive ? 'ok' : 'neutral'}>
                        {p.isActive ? 'in use' : 'off'}
                      </Badge>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>

        {canEdit && (
          <section>
            <Card>
              <h2 className="t-heading">{current ? `Edit ${current.name}` : 'New set'}</h2>
              <div className="mt-4">
                <PoolEditor
                  key={current?.id ?? 'new'}
                  assessments={assessments}
                  pool={
                    current
                      ? {
                          id: current.id,
                          name: current.name,
                          description: current.description,
                          assessmentIds: current.items.map((i) => i.assessmentId),
                        }
                      : undefined
                  }
                />
              </div>
            </Card>
          </section>
        )}
      </div>
    </div>
  );
}
