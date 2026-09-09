import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { formatMoney } from '@/lib/money';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { MembershipForm } from './editors';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function MembershipsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireTenant();
  await requireStaff('membership.manage_memberships', 'view');

  const sp = await searchParams;
  const editing = (Array.isArray(sp.edit) ? sp.edit[0] : sp.edit) as string | undefined;

  const [memberships, courses] = await Promise.all([
    db.product.findMany({
      where: { organizationId: tenant.organizationId, type: 'MEMBERSHIP', deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        status: true,
        membership: {
          select: {
            billingPeriod: true,
            description: true,
            courses: {
              select: { course: { select: { id: true, product: { select: { title: true } } } } },
            },
          },
        },
        pricingPlans: {
          where: { isActive: true },
          take: 1,
          select: { pricePaise: true, currency: true, validityDays: true },
        },
        _count: { select: { enrollments: true } },
      },
    }),
    db.course.findMany({
      where: { organizationId: tenant.organizationId },
      orderBy: { product: { title: 'asc' } },
      select: { id: true, product: { select: { title: true } } },
    }),
  ]);

  const current = memberships.find((m) => m.id === editing);

  return (
    <div>
      <PageHeader
        title="Memberships"
        description="One price that unlocks a set of courses for a while. Also a Product, so it shares the same checkout, entitlement and invoice as everything else you sell."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-3">
          {memberships.length === 0 ? (
            <EmptyState
              title="No memberships yet"
              hint="Useful when several courses are better sold together than one at a time."
            />
          ) : (
            memberships.map((m) => (
              <Card key={m.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <a href={`/admin/memberships?edit=${m.id}`} className="font-medium hover:underline">
                        {m.title}
                      </a>
                      <Badge tone={m.status === 'PUBLISHED' ? 'ok' : 'neutral'}>
                        {m.status.toLowerCase()}
                      </Badge>
                      <Badge tone="brand">{m.membership?.billingPeriod.toLowerCase()}</Badge>
                    </div>

                    <p className="t-small faint mt-1 tabular-nums">
                      {m.pricingPlans[0]
                        ? formatMoney(m.pricingPlans[0].pricePaise, m.pricingPlans[0].currency)
                        : 'No price'}
                      {m.pricingPlans[0]?.validityDays
                        ? ` · ${m.pricingPlans[0].validityDays} days access`
                        : ''}
                      {' · '}
                      {m._count.enrollments} member{m._count.enrollments === 1 ? '' : 's'}
                    </p>

                    {m.membership && m.membership.courses.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {m.membership.courses.map((c) => (
                          <span key={c.course.id} className="t-micro rounded-full border px-2 py-1">
                            {c.course.product.title}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>

        <Card>
          <h2 className="t-heading">{current ? `Edit ${current.title}` : 'New membership'}</h2>
          <div className="mt-5">
            <MembershipForm
              courses={courses.map((c) => ({ id: c.id, title: c.product.title }))}
              membership={
                current
                  ? {
                      id: current.id,
                      title: current.title,
                      description: current.membership?.description ?? '',
                      billingPeriod: current.membership?.billingPeriod ?? 'MONTHLY',
                      status: current.status,
                      courseIds: current.membership?.courses.map((c) => c.course.id) ?? [],
                    }
                  : undefined
              }
            />
          </div>
        </Card>
      </div>
    </div>
  );
}
