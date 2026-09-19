import { bearerParent } from '@/lib/api/parent';
import { fail, ok } from '@/lib/api/http';
import { childOf } from '@/lib/parent-session';
import { parentFeesData } from '@/lib/parent-fees-data';
import { failedOrders, inFlightFor, instalmentState, payOffer, processingOrders } from '@/lib/parent-fees';
import { balanceOf, summariseAccount } from '@/lib/dues';
import { feeStatusLabel } from '@/lib/misc-fees';

export const dynamic = 'force-dynamic';

/**
 * GET → the child's fees as the web page shows them: per enrolment the
 * agreed, paid and outstanding figures, the next payment and which
 * control goes with it, every instalment with its state, other charges,
 * orders processing or failed, payments with receipt numbers. Paying is
 * a handoff to the web fees page (POST /parent/web { path }).
 */
export async function GET(request: Request, { params }: { params: Promise<{ childId: string }> }) {
  const ctx = await bearerParent(request);
  if (!ctx) return fail('unauthorised', 'Sign in.', 401);
  const { childId } = await params;
  const child = await childOf(ctx.tenant.organizationId, ctx.parent.contact, childId);
  if (!child) return fail('access_removed', 'This child is no longer on your account.', 404);
  const now = new Date();
  const d = await parentFeesData(ctx.tenant.organizationId, child.id, now);
  const processing = processingOrders(d.orders);
  const failed = failedOrders(d.orders);
  return ok({
    child: { id: child.id, name: child.name },
    currency: ctx.tenant.currency,
    online: d.online,
    tax: d.tax ? { enabled: d.tax.enabled, pricesAreExclusive: d.tax.pricesAreExclusive } : null,
    payPath: `/parent/${child.id}/fees`,
    enrolments: d.enrolments.map((e) => {
      const s = summariseAccount(e.instalments, now);
      const next = e.instalments.find((i) => balanceOf(i) > 0) ?? null;
      return {
        id: e.id,
        course: e.product.title,
        batch: e.batch?.name ?? null,
        status: e.status,
        agreedPaise: s.totalPaise,
        paidPaise: s.paidPaise,
        outstandingPaise: s.balancePaise,
        overduePaise: s.overduePaise,
        oldestOverdueDays: s.oldestOverdueDays,
        next: next ? { id: next.id, sequence: next.sequence, balancePaise: balanceOf(next), dueDate: next.dueDate.toISOString(), overdue: next.dueDate < now } : null,
        offer: payOffer({ next, inFlight: next ? inFlightFor(d.orders, { instalmentId: next.id }) !== null : false, online: d.online }),
        instalments: e.instalments.map((i) => ({ id: i.id, sequence: i.sequence, amountPaise: i.amountPaise, paidPaise: Math.min(i.paidPaise, i.amountPaise), balancePaise: balanceOf(i), dueDate: i.dueDate.toISOString(), paidAt: i.paidAt?.toISOString() ?? null, state: instalmentState(i, inFlightFor(d.orders, { instalmentId: i.id }) !== null, now) })),
      };
    }),
    charges: d.charges.map((c) => ({ id: c.id, label: c.label, course: c.enrollment.product.title, amountPaise: c.amountPaise, dueDate: c.dueDate?.toISOString() ?? null, status: c.status, statusLabel: feeStatusLabel(c, now), waivedReason: c.waivedReason, processing: c.status === 'PENDING' && inFlightFor(d.orders, { miscFeeId: c.id }) !== null })),
    processing: processing.map((o) => ({ id: o.id, orderNo: o.orderNo, totalPaise: o.totalPaise, placedAt: o.placedAt.toISOString(), items: o.items.map((i) => i.titleSnapshot), checkoutPath: `/checkout/${o.id}?as=parent&child=${child.id}` })),
    failed: failed.map((o) => ({ id: o.id, orderNo: o.orderNo, status: o.status, totalPaise: o.totalPaise, placedAt: o.placedAt.toISOString(), items: o.items.map((i) => i.titleSnapshot) })),
    payments: d.payments.map((p) => ({ id: p.id, receiptNo: p.receiptNo, amountPaise: p.amountPaise, refundedPaise: p.refunds.reduce((n, r) => n + r.amountPaise, 0), at: (p.capturedAt ?? p.createdAt).toISOString(), method: p.method ?? p.gateway.toLowerCase(), reference: p.gatewayRef, status: p.status, item: ((p.raw ?? {}) as { item?: string }).item ?? 'Fee', receiptPath: p.receiptNo ? `/api/receipts/${encodeURIComponent(p.receiptNo)}/pdf` : null })),
  });
}
