import { db } from '@/lib/db';
import { paymentsAvailable } from '@/lib/payments';

/**
 * What a parent's fee screen is built from, for the web page and the
 * app alike: the enrolments with their instalments, other charges, the
 * orders still in flight or failed in the last week, the payments with
 * receipts, the tax note, and whether online payment is on.
 */
export async function parentFeesData(organizationId: string, childId: string, now = new Date()) {
  const [enrolments, charges, orders, payments, tax, online] = await Promise.all([
    db.enrollment.findMany({
      where: { organizationId: organizationId, userId: childId, instalments: { some: {} } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, product: { select: { title: true } }, batch: { select: { name: true } }, instalments: { orderBy: { sequence: 'asc' }, select: { id: true, sequence: true, amountPaise: true, paidPaise: true, dueDate: true, paidAt: true } } },
    }),
    db.miscFee.findMany({
      where: { organizationId: organizationId, userId: childId, status: { in: ['PENDING', 'PAID', 'WAIVED'] } },
      orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
      select: { id: true, label: true, amountPaise: true, dueDate: true, status: true, paidAt: true, waivedReason: true, enrollment: { select: { product: { select: { title: true } } } } },
    }),
    // Orders still in flight tell the parent a payment is processing, or
    // that the last attempt failed or was cancelled, before another is offered.
    db.order.findMany({
      where: { organizationId: organizationId, userId: childId, status: { in: ['PENDING', 'FAILED', 'CANCELLED'] }, placedAt: { gte: new Date(now.getTime() - 7 * 864e5) }, items: { some: { OR: [{ instalmentId: { not: null } }, { miscFeeId: { not: null } }] } } },
      orderBy: { placedAt: 'desc' },
      select: { id: true, orderNo: true, status: true, totalPaise: true, placedAt: true, gatewayOrderId: true, items: { select: { instalmentId: true, miscFeeId: true, titleSnapshot: true } } },
    }),
    db.payment.findMany({
      where: { organizationId: organizationId, userId: childId, status: { in: ['CAPTURED', 'REFUNDED', 'PARTIALLY_REFUNDED'] } },
      orderBy: { createdAt: 'desc' },
      take: 40,
      select: { id: true, receiptNo: true, amountPaise: true, capturedAt: true, createdAt: true, method: true, gateway: true, gatewayRef: true, status: true, raw: true, refunds: { select: { amountPaise: true, createdAt: true } } },
    }),
    db.taxConfig.findFirst({ where: { organizationId: organizationId }, select: { enabled: true, pricesAreExclusive: true } }),
    paymentsAvailable(organizationId).catch(() => false),
  ]);

  return { enrolments, charges, orders, payments, tax, online };
}

export type ParentFeesData = Awaited<ReturnType<typeof parentFeesData>>;
