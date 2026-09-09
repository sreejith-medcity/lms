import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { formatMoney } from '@/lib/money';
import { MATERIAL_LABELS, formatDuration } from '@/lib/progress';
import { Badge, Card } from '@/components/ui';
import { EnrolButton } from './enrol-button';

export const dynamic = 'force-dynamic';

export default async function CoursePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tenant = await requireTenant();
  const user = await getSessionUser();

  const product = await db.product.findFirst({
    where: {
      organizationId: tenant.organizationId,
      slug,
      type: 'COURSE',
      status: 'PUBLISHED',
      deletedAt: null,
    },
    include: {
      course: {
        include: {
          modules: {
            orderBy: { sortOrder: 'asc' },
            include: {
              module: {
                include: {
                  sections: {
                    orderBy: { sortOrder: 'asc' },
                    include: { materials: { orderBy: { sortOrder: 'asc' } } },
                  },
                },
              },
            },
          },
        },
      },
      pricingPlans: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
    },
  });
  if (!product?.course) notFound();

  const enrolled = user
    ? await db.enrollment.findFirst({
        where: { userId: user.id, productId: product.id, status: { notIn: ['CANCELLED', 'ARCHIVED'] } },
        select: { id: true },
      })
    : null;

  const plan = product.pricingPlans[0];
  const allMaterials = product.course.modules.flatMap((cm) =>
    cm.module.sections.flatMap((s) => s.materials),
  );
  const totalSeconds = allMaterials.reduce((n, m) => n + (m.durationSeconds ?? 0), 0);

  return (
    <main className="mx-auto max-w-4xl p-8">
      <Link href="/" className="text-sm text-slate-500 hover:underline">
        All courses
      </Link>

      <header className="mt-4">
        <h1 className="text-2xl font-semibold">{product.title}</h1>
        <p className="mt-2 max-w-2xl whitespace-pre-line text-slate-600">
          {product.course.description}
        </p>
        <p className="mt-3 text-sm text-slate-500">
          {allMaterials.length} materials
          {totalSeconds > 0 && ` · ${formatDuration(totalSeconds)}`}
          {product.course.level && ` · ${product.course.level}`}
        </p>
      </header>

      <div className="mt-6 flex flex-wrap items-center gap-4 rounded-xl border bg-white p-5">
        <div>
          <span className="text-2xl font-semibold" style={{ color: 'var(--brand)' }}>
            {plan ? formatMoney(plan.pricePaise, plan.currency) : 'Free'}
          </span>
          {plan?.mrpPaise ? (
            <span className="ml-2 text-slate-400 line-through">
              {formatMoney(plan.mrpPaise, plan.currency)}
            </span>
          ) : null}
          {plan?.validityDays ? (
            <p className="mt-1 text-xs text-slate-500">Access for {plan.validityDays} days</p>
          ) : null}
        </div>

        <div className="ml-auto">
          {enrolled ? (
            <Link
              href={`/learn/${product.id}`}
              className="inline-flex rounded-lg px-4 py-2 text-sm font-medium text-white"
              style={{ background: 'var(--brand)' }}
            >
              Continue learning
            </Link>
          ) : (
            <EnrolButton productId={product.id} signedIn={Boolean(user)} />
          )}
        </div>
      </div>

      <h2 className="mt-10 text-lg font-medium">What you will cover</h2>
      <div className="mt-4 space-y-4">
        {product.course.modules.map((cm) => (
          <Card key={cm.moduleId}>
            <h3 className="font-medium">{cm.module.name}</h3>
            <div className="mt-3 space-y-3">
              {cm.module.sections.map((section) => (
                <div key={section.id}>
                  <p className="text-sm font-medium text-slate-700">{section.title}</p>
                  <ul className="mt-1 space-y-1">
                    {section.materials.map((m) => (
                      <li key={m.id} className="flex items-center gap-2 text-sm text-slate-600">
                        <span className="text-slate-400">{MATERIAL_LABELS[m.type] ?? m.type}</span>
                        <span>{m.title}</span>
                        {m.isFreePreview && <Badge tone="green">Free preview</Badge>}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {cm.module.sections.length === 0 && (
                <p className="text-sm text-slate-400">Content coming soon.</p>
              )}
            </div>
          </Card>
        ))}
        {product.course.modules.length === 0 && (
          <p className="text-sm text-slate-500">The curriculum is being prepared.</p>
        )}
      </div>
    </main>
  );
}
