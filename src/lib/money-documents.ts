import type { SessionUser } from '@/lib/auth';

/**
 * Who may open a receipt or invoice: the learner it was issued to, or staff
 * who handle money. Anyone else gets a 404 rather than a 403, so a guessed
 * number confirms nothing.
 */
export function mayViewMoneyDocument(user: SessionUser, ownerId: string | null): boolean {
  if (ownerId && user.id === ownerId) return true;
  if (user.kind !== 'STAFF') return false;
  return Boolean(
    user.permissions['sales.payments']?.view || user.permissions['sales.fee_tracking']?.view,
  );
}

/* Loading a document ------------------------------------------------------ */

import { db } from '@/lib/db';
import type { MoneyDocumentProps } from '@/components/money-document';

/** Everything a receipt or invoice shows, minus the page's own back link. */
export type MoneyDocumentData = Omit<MoneyDocumentProps, 'backHref' | 'backLabel'> & { ownerId: string | null };

async function issuerFor(organizationId: string) {
  const [organization, taxConfig] = await Promise.all([
    db.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, legalName: true, addressLine: true, city: true, state: true, pincode: true, supportEmail: true, contactNumber: true, logoUrl: true },
    }),
    db.taxConfig.findFirst({ where: { organizationId }, select: { gstin: true, pan: true, cgstPercent: true, sgstPercent: true, igstPercent: true } }),
  ]);
  if (!organization) return null;
  return { issuer: { ...organization, gstin: taxConfig?.gstin, pan: taxConfig?.pan }, taxConfig };
}

/**
 * The invoice behind a paid order. Issued once when the order was paid and
 * never edited, so this only reads what fulfilment wrote. One loader for
 * the page, the PDF and the email attachment, so the three cannot differ.
 */
export async function invoiceDocument(organizationId: string, invoiceNo: string): Promise<MoneyDocumentData | null> {
  const invoice = await db.invoice.findFirst({
    where: { invoiceNo, order: { organizationId } },
    select: {
      invoiceNo: true,
      issuedAt: true,
      taxBreakup: true,
      placeOfSupply: true,
      order: {
        select: {
          userId: true,
          orderNo: true,
          currency: true,
          subtotalPaise: true,
          discountPaise: true,
          taxPaise: true,
          walletPaise: true,
          totalPaise: true,
          gstin: true,
          user: { select: { name: true, email: true, phone: true } },
          items: { select: { id: true, titleSnapshot: true, pricePaise: true, discountPaise: true } },
          payments: {
            where: { status: { in: ['CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED'] } },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { method: true, gateway: true, gatewayRef: true },
          },
        },
      },
    },
  });
  if (!invoice) return null;
  const who = await issuerFor(organizationId);
  if (!who) return null;

  const breakup = (invoice.taxBreakup ?? {}) as { cgst?: number; sgst?: number; igst?: number };
  const order = invoice.order;
  const payment = order.payments[0];
  const tax = who.taxConfig;

  const totals: MoneyDocumentData['totals'] = [{ label: 'Subtotal', amountPaise: order.subtotalPaise }];
  if (order.discountPaise > 0) totals.push({ label: 'Discount', amountPaise: -order.discountPaise });
  if (breakup.igst) totals.push({ label: `IGST ${tax?.igstPercent ?? 18}%`, amountPaise: breakup.igst });
  if (breakup.cgst) totals.push({ label: `CGST ${tax?.cgstPercent ?? 9}%`, amountPaise: breakup.cgst });
  if (breakup.sgst) totals.push({ label: `SGST ${tax?.sgstPercent ?? 9}%`, amountPaise: breakup.sgst });
  if (!breakup.igst && !breakup.cgst && !breakup.sgst && order.taxPaise > 0) totals.push({ label: 'Tax', amountPaise: order.taxPaise });
  if (order.walletPaise > 0) totals.push({ label: 'Paid with points', amountPaise: -order.walletPaise });
  totals.push({ label: 'Total', amountPaise: order.totalPaise, strong: true });

  return {
    kind: 'INVOICE',
    number: invoice.invoiceNo,
    issuedAt: invoice.issuedAt,
    currency: order.currency,
    issuer: who.issuer,
    recipient: order.user,
    lines: order.items.map((i) => ({
      title: i.titleSnapshot,
      detail: i.discountPaise > 0 ? `Less discount ${(i.discountPaise / 100).toFixed(2)}` : undefined,
      amountPaise: i.pricePaise,
    })),
    totals,
    paidBy: payment ? (payment.method ?? payment.gateway.toLowerCase()) : null,
    reference: payment?.gatewayRef ?? null,
    note: [`Order ${order.orderNo}.`, order.gstin ? `Buyer GSTIN ${order.gstin}.` : null, invoice.placeOfSupply ? `Place of supply: ${invoice.placeOfSupply}.` : null].filter(Boolean).join(' '),
    ownerId: order.userId,
  };
}

/** The receipt for one payment: a gateway capture, a counter payment, a cleared cheque. */
export async function receiptDocument(organizationId: string, receiptNo: string): Promise<MoneyDocumentData | null> {
  const payment = await db.payment.findFirst({
    where: { organizationId, receiptNo, status: { not: 'FAILED' } },
    select: { id: true, userId: true, receiptNo: true, method: true, gateway: true, gatewayRef: true, amountPaise: true, currency: true, capturedAt: true, createdAt: true, status: true, raw: true },
  });
  if (!payment || !payment.receiptNo) return null;
  const [learner, who] = await Promise.all([
    payment.userId ? db.user.findFirst({ where: { id: payment.userId, organizationId }, select: { name: true, email: true, phone: true } }) : null,
    issuerFor(organizationId),
  ]);
  if (!who) return null;

  const raw = (payment.raw ?? {}) as { item?: string; note?: string | null; allocations?: { sequence: number; paise: number; settles: boolean }[] };
  const lines = raw.allocations?.length
    ? raw.allocations.map((a) => ({ title: `${raw.item ?? 'Course fee'}: instalment ${a.sequence}`, detail: a.settles ? undefined : 'Part payment', amountPaise: a.paise }))
    : [{ title: raw.item ?? 'Fee', amountPaise: payment.amountPaise }];
  const refunded = payment.status === 'REFUNDED' || payment.status === 'PARTIALLY_REFUNDED';

  return {
    kind: 'RECEIPT',
    number: payment.receiptNo,
    issuedAt: payment.capturedAt ?? payment.createdAt,
    currency: payment.currency,
    issuer: who.issuer,
    recipient: learner ?? { name: 'Learner' },
    lines,
    totals: [{ label: 'Total received', amountPaise: payment.amountPaise, strong: true }],
    paidBy: payment.method ?? payment.gateway.toLowerCase(),
    reference: payment.gatewayRef,
    note: [raw.note, refunded ? `This payment has since been ${payment.status === 'REFUNDED' ? 'refunded' : 'partly refunded'}.` : null].filter(Boolean).join(' ') || undefined,
    ownerId: payment.userId,
  };
}
