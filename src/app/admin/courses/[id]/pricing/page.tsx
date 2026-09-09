import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { formatMoney } from '@/lib/money';
import { Badge, Card, EmptyState } from '@/components/ui';
import { AddPlanForm, DeletePlanButton } from './editors';

export const dynamic = 'force-dynamic';

export default async function PricingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await requireTenant();

  const product = await db.product.findFirst({
    where: { id, organizationId: tenant.organizationId, type: 'COURSE' },
    select: {
      id: true,
      status: true,
      course: { select: { publishWeb: true, publishAndroid: true, publishIos: true } },
      pricingPlans: {
        orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }],
        include: { _count: { select: { enrollments: true } } },
      },
    },
  });
  if (!product?.course) notFound();

  return (
    <div className="max-w-3xl space-y-6">
      <Card>
        <h2 className="text-sm font-semibold text-slate-700">Pricing plans</h2>
        <p className="mt-1 text-sm text-slate-500">
          A course can carry several: a full fee, a shorter validity, a free tier.
        </p>

        <div className="mt-4 overflow-x-auto">
          {product.pricingPlans.length === 0 ? (
            <EmptyState title="No plans yet" hint="Until a plan exists, nobody can enrol." />
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500">
                <tr>
                  <th className="py-2">Plan</th>
                  <th className="py-2">Price</th>
                  <th className="py-2">Validity</th>
                  <th className="py-2">Enrolments</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {product.pricingPlans.map((p) => (
                  <tr key={p.id} className="border-t">
                    <td className="py-2.5">
                      <span className={p.isActive ? '' : 'text-slate-400 line-through'}>{p.name}</span>
                      {!p.isActive && (
                        <span className="ml-2">
                          <Badge>retired</Badge>
                        </span>
                      )}
                    </td>
                    <td className="py-2.5">
                      {formatMoney(p.pricePaise, p.currency)}
                      {p.mrpPaise ? (
                        <span className="ml-2 text-xs text-slate-400 line-through">
                          {formatMoney(p.mrpPaise, p.currency)}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2.5">{p.validityDays ? `${p.validityDays} days` : 'No expiry'}</td>
                    <td className="py-2.5">{p._count.enrollments}</td>
                    <td className="py-2.5 text-right">
                      {p.isActive && <DeletePlanButton planId={p.id} productId={product.id} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 text-sm font-semibold text-slate-700">Add a plan</h2>
        <AddPlanForm productId={product.id} currency={tenant.currency} />
      </Card>

      <Card>
        <h2 className="text-sm font-semibold text-slate-700">Where it appears</h2>
        <p className="mt-1 text-sm text-slate-500">
          The course is {product.status === 'PUBLISHED' ? 'live' : 'not live'} on{' '}
          {[
            product.course.publishWeb && 'web',
            product.course.publishAndroid && 'Android',
            product.course.publishIos && 'iOS',
          ]
            .filter(Boolean)
            .join(', ') || 'no platform'}
          . Use the Publish button at the top to change that.
        </p>
      </Card>
    </div>
  );
}
