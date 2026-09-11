import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { mayViewMoneyDocument } from '@/lib/money-documents';
import { MoneyDocument } from '@/components/money-document';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Invoice', robots: { index: false, follow: false } };

/**
 * The invoice behind a paid order, printable. Issued once when the order was
 * paid and never edited, so this only reads what fulfilment wrote.
 */
export default async function InvoicePage({ params }: { params: Promise<{ invoiceNo: string }> }) {
  const tenant = await requireTenant();
  const user = await getSessionUser();
  if (!user) return null;
  const { invoiceNo } = await params;

  const invoice = await db.invoice.findFirst({
    where: { invoiceNo, order: { organizationId: tenant.organizationId } },
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
  if (!invoice) notFound();
  if (!mayViewMoneyDocument(user, invoice.order.userId)) notFound();

  const [organization, taxConfig] = await Promise.all([
    db.organization.findUnique({
      where: { id: tenant.organizationId },
      select: {
        name: true,
        legalName: true,
        addressLine: true,
        city: true,
        state: true,
        pincode: true,
        supportEmail: true,
        contactNumber: true,
        logoUrl: true,
      },
    }),
    db.taxConfig.findFirst({
      where: { organizationId: tenant.organizationId },
      select: { gstin: true, pan: true, cgstPercent: true, sgstPercent: true, igstPercent: true },
    }),
  ]);
  if (!organization) notFound();

  const breakup = (invoice.taxBreakup ?? {}) as { cgst?: number; sgst?: number; igst?: number };
  const order = invoice.order;
  const payment = order.payments[0];

  const totals: { label: string; amountPaise: number; strong?: boolean }[] = [
    { label: 'Subtotal', amountPaise: order.subtotalPaise },
  ];
  if (order.discountPaise > 0) totals.push({ label: 'Discount', amountPaise: -order.discountPaise });
  if (breakup.igst) totals.push({ label: `IGST ${taxConfig?.igstPercent ?? 18}%`, amountPaise: breakup.igst });
  if (breakup.cgst) totals.push({ label: `CGST ${taxConfig?.cgstPercent ?? 9}%`, amountPaise: breakup.cgst });
  if (breakup.sgst) totals.push({ label: `SGST ${taxConfig?.sgstPercent ?? 9}%`, amountPaise: breakup.sgst });
  if (!breakup.igst && !breakup.cgst && !breakup.sgst && order.taxPaise > 0) {
    totals.push({ label: 'Tax', amountPaise: order.taxPaise });
  }
  if (order.walletPaise > 0) totals.push({ label: 'Paid with points', amountPaise: -order.walletPaise });
  totals.push({ label: 'Total', amountPaise: order.totalPaise, strong: true });

  const staffView = user.kind === 'STAFF' && user.id !== order.userId;

  return (
    <MoneyDocument
      kind="INVOICE"
      number={invoice.invoiceNo}
      issuedAt={invoice.issuedAt}
      currency={order.currency}
      issuer={{ ...organization, gstin: taxConfig?.gstin, pan: taxConfig?.pan }}
      recipient={order.user}
      lines={order.items.map((i) => ({
        title: i.titleSnapshot,
        detail: i.discountPaise > 0 ? `Less discount ${(i.discountPaise / 100).toFixed(2)}` : undefined,
        amountPaise: i.pricePaise,
      }))}
      totals={totals}
      paidBy={payment ? (payment.method ?? payment.gateway.toLowerCase()) : null}
      reference={payment?.gatewayRef ?? null}
      note={[
        `Order ${order.orderNo}.`,
        order.gstin ? `Buyer GSTIN ${order.gstin}.` : null,
        invoice.placeOfSupply ? `Place of supply: ${invoice.placeOfSupply}.` : null,
      ]
        .filter(Boolean)
        .join(' ')}
      backHref={staffView ? '/admin/invoices' : '/learn/purchases'}
      backLabel={staffView ? 'Back to invoices' : 'Back to purchases'}
    />
  );
}
