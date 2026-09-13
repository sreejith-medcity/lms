import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { requireStaff } from '@/lib/auth';
import { formatMoney } from '@/lib/money';
import { bundleSaving } from '@/lib/learning-paths';
import { Badge, Card, Cell, EmptyState, PageHeader, Row, Table } from '@/components/ui';
import { AddPlanForm, DeletePlanButton } from '@/app/admin/courses/[id]/pricing/editors';
import { PublishToggle } from '@/app/admin/courses/[id]/publish-toggle';
import { BundleForm } from '../bundle-form';
import { bundleCourseOptions } from '../options';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

const PLAN_LABEL: Record<string, string> = {
  ONE_TIME: 'In full',
  INSTALMENT: 'Instalments',
  SUBSCRIPTION: 'Subscription',
  FREE: 'Free',
};

/**
 * One bundle: what is in it, what it costs, and whether it is on sale. The
 * pricing table is the course one, because a bundle is priced like a course;
 * the saving line under it is the only thing a buyer will actually read.
 */
export default async function BundlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await requireTenant();
  const me = await requireStaff('courses.course_management', 'view');
  const canEdit = me.permissions['courses.course_management']?.edit ?? false;
  const canDelete = me.permissions['courses.course_management']?.delete ?? false;
  const canPrice = me.permissions['courses.pricing_and_publish']?.edit ?? false;

  const [product, courses, branches] = await Promise.all([
    db.product.findFirst({
      where: { id, organizationId: tenant.organizationId, type: 'BUNDLE', deletedAt: null },
      select: {
        id: true,
        title: true,
        slug: true,
        status: true,
        isFeatured: true,
        bundle: {
          select: {
            description: true,
            thumbnailAssetId: true,
            items: {
              orderBy: { sortOrder: 'asc' },
              select: {
                productId: true,
                product: {
                  select: {
                    title: true,
                    status: true,
                    pricingPlans: { where: { isActive: true }, orderBy: { sortOrder: 'asc' }, take: 1, select: { pricePaise: true } },
                  },
                },
              },
            },
          },
        },
        pricingPlans: {
          orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }],
          include: { branch: { select: { name: true } }, _count: { select: { enrollments: true } } },
        },
      },
    }),
    bundleCourseOptions(tenant.organizationId),
    db.branch.findMany({
      where: { organizationId: tenant.organizationId, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ]);
  if (!product?.bundle) notFound();

  const headline = product.pricingPlans.find((p) => p.isActive);
  const parts = product.bundle.items.map((i) => i.product.pricingPlans[0]?.pricePaise ?? 0);
  const saving = headline ? bundleSaving(headline.pricePaise, parts) : null;
  const unpublishedInside = product.bundle.items.filter((i) => i.product.status !== 'PUBLISHED');

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title={product.title}
        description={
          product.status === 'PUBLISHED'
            ? `On sale at /bundle/${product.slug}.`
            : 'Not on sale yet. Set a price, then publish.'
        }
        action={
          canPrice ? <PublishToggle productId={product.id} published={product.status === 'PUBLISHED'} /> : undefined
        }
      />

      {product.status === 'PUBLISHED' && (
        <p className="t-small">
          <Link href={`/bundle/${product.slug}`} className="underline" style={{ color: 'var(--brand)' }}>
            Open the bundle page
          </Link>
        </p>
      )}

      {unpublishedInside.length > 0 && (
        <Card className="border-[var(--warn)]/40">
          <p className="t-small">
            <Badge tone="warn">Check</Badge>{' '}
            {unpublishedInside.map((i) => i.product.title).join(', ')}{' '}
            {unpublishedInside.length === 1 ? 'is' : 'are'} not published. A buyer is enrolled anyway, but the course
            page they are sent to will not be public.
          </p>
        </Card>
      )}

      <BundleForm
        bundle={{
          id: product.id,
          title: product.title,
          description: product.bundle.description ?? '',
          thumbnailAssetId: product.bundle.thumbnailAssetId,
          isFeatured: product.isFeatured,
          courseProductIds: product.bundle.items.map((i) => i.productId),
        }}
        courses={courses}
        canDelete={canDelete}
      />

      <Card padded={false}>
        <div className="p-5">
          <h2 className="t-heading">Price</h2>
          <p className="t-small muted mt-1 max-w-prose">
            {saving && saving.separatelyPaise > 0
              ? `Bought one by one the courses come to ${formatMoney(saving.separatelyPaise, tenant.currency)}. ${
                  saving.savingPaise > 0
                    ? `At ${formatMoney(headline!.pricePaise, headline!.currency)} the bundle saves ${formatMoney(saving.savingPaise, tenant.currency)} (${saving.savingPercent}%), and the page says so.`
                    : 'The bundle is not cheaper than that yet, so the page shows no saving.'
                }`
              : 'A bundle needs a plan before anyone can buy it. The page shows the saving against the courses bought one by one.'}
          </p>
        </div>
        {product.pricingPlans.length === 0 ? (
          <div className="p-5 pt-0">
            <EmptyState title="No plans yet" hint="Until a plan exists, nobody can buy the bundle." />
          </div>
        ) : (
          <Table head={['Plan', 'Price', 'Paid', 'Branch', 'Validity', 'Sold', '']}>
            {product.pricingPlans.map((p) => (
              <Row key={p.id}>
                <Cell>
                  <span className={p.isActive ? 'font-medium' : 'faint line-through'}>{p.name}</span>
                  {!p.isActive && (
                    <span className="ml-2">
                      <Badge>retired</Badge>
                    </span>
                  )}
                </Cell>
                <Cell className="whitespace-nowrap">
                  {formatMoney(p.pricePaise, p.currency)}
                  {p.mrpPaise ? <span className="t-small faint ml-2 line-through">{formatMoney(p.mrpPaise, p.currency)}</span> : null}
                </Cell>
                <Cell className="text-sm">{PLAN_LABEL[p.planType] ?? p.planType}</Cell>
                <Cell className="muted">{p.branch?.name ?? 'Every branch'}</Cell>
                <Cell>{p.validityDays ? `${p.validityDays} days` : 'No expiry'}</Cell>
                <Cell className="tabular-nums">{p._count.enrollments}</Cell>
                <Cell className="text-right">{p.isActive && canPrice && <DeletePlanButton planId={p.id} productId={product.id} />}</Cell>
              </Row>
            ))}
          </Table>
        )}
      </Card>

      {canPrice && (
        <Card>
          <h2 className="t-heading mb-4">Add a plan</h2>
          <AddPlanForm productId={product.id} currency={tenant.currency} branches={branches} />
        </Card>
      )}
      {!canEdit && <p className="t-small faint">You can see this bundle but not change it.</p>}
    </div>
  );
}
