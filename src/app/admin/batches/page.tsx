import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

export default async function BatchesPage() {
  const tenant = await requireTenant();

  const batches = await db.batch.findMany({
    where: { organizationId: tenant.organizationId, deletedAt: null },
    include: {
      course: { include: { product: true } },
      _count: { select: { enrollments: true, sessions: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Batches</h1>
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="p-3">Batch</th>
              <th className="p-3">Course</th>
              <th className="p-3">Status</th>
              <th className="p-3">Learners</th>
              <th className="p-3">Sessions</th>
              <th className="p-3">Progress</th>
            </tr>
          </thead>
          <tbody>
            {batches.map((b) => (
              <tr key={b.id} className="border-t">
                <td className="p-3 font-medium">{b.name}</td>
                <td className="p-3 text-slate-600">{b.course.product.title}</td>
                <td className="p-3">{b.status}</td>
                <td className="p-3">{b._count.enrollments}</td>
                <td className="p-3">{b._count.sessions}</td>
                <td className="p-3">{b.progressPercent.toFixed(0)}%</td>
              </tr>
            ))}
            {batches.length === 0 && (
              <tr>
                <td className="p-6 text-center text-slate-500" colSpan={6}>
                  No batches yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
