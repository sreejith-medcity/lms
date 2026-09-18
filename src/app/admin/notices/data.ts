import { db } from '@/lib/db';
import { batchWhere, branchWhere, type StaffScope } from '@/lib/scope';

/** The branches and batches a sender may pick from: their scope, nothing beyond it. */
export async function audienceOptions(organizationId: string, scope: StaffScope) {
  const [branches, batches] = await Promise.all([
    scope.kind === 'batches'
      ? Promise.resolve([])
      : db.branch.findMany({ where: { organizationId, ...branchWhere(scope) }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    db.batch.findMany({
      where: { organizationId, deletedAt: null, status: { in: ['UPCOMING', 'ACTIVE'] }, ...batchWhere(scope) },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, branchId: true, course: { select: { product: { select: { title: true } } } } },
    }),
  ]);
  return {
    branches,
    batches: batches.map((b) => ({ id: b.id, name: `${b.name} · ${b.course.product.title}`, branchId: b.branchId })),
  };
}

export const STATUS_TONE = { DRAFT: 'neutral', PUBLISHED: 'ok', WITHDRAWN: 'bad' } as const;
export const STATUS_LABEL = { DRAFT: 'draft', PUBLISHED: 'published', WITHDRAWN: 'withdrawn' } as const;
