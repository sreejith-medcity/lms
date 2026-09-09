import type { $Enums } from '@prisma/client';
import { db } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

export default async function LearnersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const tenant = await requireTenant();
  const { q, status } = await searchParams;

  const learners = await db.user.findMany({
    where: {
      organizationId: tenant.organizationId,
      kind: 'LEARNER',
      deletedAt: null,
      ...(status ? { status: status as $Enums.UserStatus } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' as const } },
              { email: { contains: q, mode: 'insensitive' as const } },
              { phone: { contains: q } },
            ],
          }
        : {}),
    },
    include: { _count: { select: { enrollments: true } } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Learners</h1>

      <form className="flex gap-2">
        <input
          name="q"
          defaultValue={q ?? ''}
          placeholder="Search by name, email or phone"
          className="w-72 rounded-lg border px-3 py-2 text-sm"
        />
        <button className="rounded-lg border px-3 py-2 text-sm">Search</button>
      </form>

      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="p-3">Name</th>
              <th className="p-3">Contact</th>
              <th className="p-3">Status</th>
              <th className="p-3">Reg. no</th>
              <th className="p-3">Enrolments</th>
            </tr>
          </thead>
          <tbody>
            {learners.map((l) => (
              <tr key={l.id} className="border-t">
                <td className="p-3 font-medium">{l.name}</td>
                <td className="p-3 text-slate-600">
                  {l.email}
                  {l.phone ? <span className="block text-xs">{l.phone}</span> : null}
                </td>
                <td className="p-3">{l.status}</td>
                <td className="p-3">{l.registrationNo ?? '—'}</td>
                <td className="p-3">{l._count.enrollments}</td>
              </tr>
            ))}
            {learners.length === 0 && (
              <tr>
                <td className="p-6 text-center text-slate-500" colSpan={5}>
                  No learners match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
