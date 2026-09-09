import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { formatMoney } from '@/lib/money';
import { Badge, Card, Cell, EmptyState, Row, Table } from '@/components/ui';
import { AddPlanForm, DeletePlanButton, PublishingForm } from './editors';

export const dynamic = 'force-dynamic';

const PLAN_LABEL: Record<string, string> = {
  ONE_TIME: 'In full',
  INSTALMENT: 'Instalments',
  SUBSCRIPTION: 'Subscription',
  FREE: 'Free',
};

interface Instalment {
  dueOffsetDays?: number;
  amountPaise?: number;
}

export default async function PricingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await requireTenant();
  const me = await requireStaff('courses.pricing_and_publish', 'view');
  const canEdit = me.permissions['courses.pricing_and_publish']?.edit ?? false;

  const [product, branches] = await Promise.all([
    db.product.findFirst({
      where: { id, organizationId: tenant.organizationId, type: 'COURSE' },
      select: {
        id: true,
        status: true,
        isFeatured: true,
        course: {
          select: {
            publishWeb: true,
            publishAndroid: true,
            publishIos: true,
            freePreviewEnabled: true,
            onDemandOnly: true,
            appleIapProductId: true,
          },
        },
        pricingPlans: {
          orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }],
          include: {
            branch: { select: { name: true } },
            _count: { select: { enrollments: true } },
          },
        },
      },
    }),
    db.branch.findMany({
      where: { organizationId: tenant.organizationId, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ]);
  if (!product?.course) notFound();

  return (
    <div className="max-w-3xl space-y-6">
      <Card padded={false}>
        <div className="p-5">
          <h2 className="t-heading">Pricing plans</h2>
          <p className="t-small muted mt-1 max-w-prose">
            A course can carry several: a full fee, an instalment plan, a shorter validity, a price
            that only one branch sells. A learner picks one at checkout.
          </p>
        </div>

        {product.pricingPlans.length === 0 ? (
          <div className="p-5 pt-0">
            <EmptyState title="No plans yet" hint="Until a plan exists, nobody can enrol." />
          </div>
        ) : (
          <Table head={['Plan', 'Price', 'Paid', 'Branch', 'Validity', 'Enrolments', '']}>
            {product.pricingPlans.map((p) => {
              const schedule = Array.isArray(p.instalmentPlan)
                ? (p.instalmentPlan as Instalment[])
                : [];
              return (
                <Row key={p.id}>
                  <Cell>
                    <span className={p.isActive ? 'font-medium' : 'faint line-through'}>
                      {p.name}
                    </span>
                    {!p.isActive && (
                      <span className="ml-2">
                        <Badge>retired</Badge>
                      </span>
                    )}
                  </Cell>
                  <Cell className="whitespace-nowrap">
                    {formatMoney(p.pricePaise, p.currency)}
                    {p.mrpPaise ? (
                      <span className="t-small faint ml-2 line-through">
                        {formatMoney(p.mrpPaise, p.currency)}
                      </span>
                    ) : null}
                  </Cell>
                  <Cell>
                    <span className="text-sm">{PLAN_LABEL[p.planType] ?? p.planType}</span>
                    {p.planType === 'INSTALMENT' && (
                      <p className="t-micro faint">
                        {p.instalmentCount} payments
                        {schedule.length > 1 && schedule[1]?.dueOffsetDays
                          ? `, ${schedule[1].dueOffsetDays} days apart`
                          : ''}
                        {p.invoiceAnchor === 'ENROLLMENT' ? ', from enrolment' : ', from batch start'}
                      </p>
                    )}
                  </Cell>
                  <Cell className="muted">{p.branch?.name ?? 'Every branch'}</Cell>
                  <Cell>{p.validityDays ? `${p.validityDays} days` : 'No expiry'}</Cell>
                  <Cell className="tabular-nums">{p._count.enrollments}</Cell>
                  <Cell className="text-right">
                    {p.isActive && canEdit && (
                      <DeletePlanButton planId={p.id} productId={product.id} />
                    )}
                  </Cell>
                </Row>
              );
            })}
          </Table>
        )}
      </Card>

      {canEdit && (
        <Card>
          <h2 className="t-heading mb-4">Add a plan</h2>
          <AddPlanForm productId={product.id} currency={tenant.currency} branches={branches} />
        </Card>
      )}

      <Card>
        <h2 className="t-heading">Where it appears</h2>
        <p className="t-small muted mt-1 max-w-prose">
          The course is {product.status === 'PUBLISHED' ? 'published' : 'a draft'}. Publishing is the
          top-level switch; these decide where a published course can actually be reached.
        </p>
        <div className="mt-4">
          <PublishingForm
            productId={product.id}
            published={product.status === 'PUBLISHED'}
            canEdit={canEdit}
            values={{
              publishWeb: product.course.publishWeb,
              publishAndroid: product.course.publishAndroid,
              publishIos: product.course.publishIos,
              freePreviewEnabled: product.course.freePreviewEnabled,
              onDemandOnly: product.course.onDemandOnly,
              isFeatured: product.isFeatured,
              appleIapProductId: product.course.appleIapProductId ?? '',
            }}
          />
        </div>
      </Card>
    </div>
  );
}
