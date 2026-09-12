import type { PrismaClient } from '@prisma/client';
import type { CourseOption } from './[id]/editor';

/** Every course with its live batches, for the pickers. */
export async function courseOptions(db: PrismaClient, organizationId: string): Promise<CourseOption[]> {
  const rows = await db.course.findMany({
    where: { organizationId, product: { deletedAt: null } },
    orderBy: { product: { title: 'asc' } },
    select: {
      id: true,
      product: { select: { title: true } },
      batches: {
        where: { deletedAt: null, status: { notIn: ['COMPLETED', 'ARCHIVED'] } },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      },
    },
  });
  return rows.map((r) => ({ id: r.id, title: r.product.title, batches: r.batches }));
}
