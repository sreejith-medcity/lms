import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import { toCsv } from '@/lib/csv';
import { toRupees } from '@/lib/money';

export const dynamic = 'force-dynamic';

/**
 * The learner list, as a file.
 *
 * One row per learner rather than one per enrolment, because the thing people
 * do with this is mail-merge, and a duplicated name breaks that. Courses are
 * joined into one cell for the same reason.
 *
 * Exporting personal data is itself an event worth recording, so it is.
 */
export async function GET(request: Request) {
  const tenant = await requireTenant();

  let staff;
  try {
    staff = await requireStaff('learner.learner_export', 'view');
  } catch {
    return new NextResponse('Not allowed', { status: 403 });
  }
  if (staff.organizationId !== tenant.organizationId) {
    return new NextResponse('Not allowed', { status: 403 });
  }

  const url = new URL(request.url);
  const batchId = url.searchParams.get('batch') ?? '';
  const productId = url.searchParams.get('course') ?? '';

  const learners = await db.user.findMany({
    where: {
      organizationId: tenant.organizationId,
      kind: 'LEARNER',
      deletedAt: null,
      ...(batchId || productId
        ? {
            enrollments: {
              some: {
                ...(batchId ? { batchId } : {}),
                ...(productId ? { productId } : {}),
              },
            },
          }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 20000,
    select: {
      id: true,
      registrationNo: true,
      name: true,
      email: true,
      phone: true,
      status: true,
      createdAt: true,
      enrollments: {
        select: {
          status: true,
          progressPercent: true,
          product: { select: { title: true } },
          batch: { select: { name: true } },
        },
      },
      wallet: { select: { balancePoints: true } },
    },
  });

  // Collections per learner, so the file answers "who still owes us" without a
  // second export to reconcile against.
  const paid = await db.payment.groupBy({
    by: ['userId'],
    where: { organizationId: tenant.organizationId, status: 'CAPTURED' },
    _sum: { amountPaise: true },
  });
  const paidBy = new Map(paid.map((p) => [p.userId, p._sum.amountPaise ?? 0]));

  const rows: (string | number | null)[][] = [
    [
      'Registration no',
      'Name',
      'Email',
      'Mobile',
      'Status',
      'Signed up',
      'Courses',
      'Batches',
      'Average progress %',
      `Paid (${tenant.currency})`,
      'Credit points',
    ],
    ...learners.map((l) => {
      const courses = l.enrollments.map((e) => e.product.title);
      const batches = l.enrollments.map((e) => e.batch?.name).filter(Boolean) as string[];
      const progress = l.enrollments.length
        ? Math.round(
            l.enrollments.reduce((n, e) => n + e.progressPercent, 0) / l.enrollments.length,
          )
        : 0;

      return [
        l.registrationNo ?? '',
        l.name,
        l.email ?? '',
        l.phone ?? '',
        l.status.toLowerCase(),
        l.createdAt.toISOString().slice(0, 10),
        courses.join('; '),
        [...new Set(batches)].join('; '),
        progress,
        toRupees(paidBy.get(l.id) ?? 0).toFixed(2),
        l.wallet?.balancePoints ?? 0,
      ];
    }),
  ];

  await recordAudit({
    organizationId: tenant.organizationId,
    actorId: staff.id,
    action: 'learner.exported',
    entity: 'User',
    entityId: 'bulk',
    after: { rows: learners.length, batchId: batchId || null, productId: productId || null },
  });

  const stamp = new Date().toISOString().slice(0, 10);

  return new NextResponse(toCsv(rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="learners-${stamp}.csv"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
