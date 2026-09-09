import Link from 'next/link';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { formatMoney } from '@/lib/money';

export default async function CoursesPage() {
  const tenant = await requireTenant();

  const products = await db.product.findMany({
    where: { organizationId: tenant.organizationId, type: 'COURSE', deletedAt: null },
    include: {
      course: true,
      pricingPlans: { where: { isActive: true }, orderBy: { sortOrder: 'asc' }, take: 1 },
      _count: { select: { enrollments: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Courses</h1>
        <Link
          href="/admin/courses/new"
          className="rounded-lg px-3 py-2 text-sm text-white"
          style={{ background: 'var(--brand)' }}
        >
          New course
        </Link>
      </div>

      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="p-3">Course</th>
              <th className="p-3">Status</th>
              <th className="p-3">Price</th>
              <th className="p-3">Enrolments</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id} className="border-t">
                <td className="p-3">
                  <Link href={`/admin/courses/${p.id}`} className="font-medium hover:underline">
                    {p.title}
                  </Link>
                </td>
                <td className="p-3">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">
                    {p.status}
                  </span>
                </td>
                <td className="p-3">
                  {p.pricingPlans[0]
                    ? formatMoney(p.pricingPlans[0].pricePaise, p.pricingPlans[0].currency)
                    : '—'}
                </td>
                <td className="p-3">{p._count.enrollments}</td>
              </tr>
            ))}
            {products.length === 0 && (
              <tr>
                <td className="p-6 text-center text-slate-500" colSpan={4}>
                  No courses yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
