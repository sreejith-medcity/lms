import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { formatMoney } from '@/lib/money';
import { razorpayConfig } from '@/lib/razorpay';
import { PayNow } from './pay-now';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Checkout', robots: { index: false, follow: false } };

export default async function CheckoutPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const tenant = await requireTenant();
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const config = razorpayConfig();

  const order = await db.order.findFirst({
    where: { id: orderId, organizationId: tenant.organizationId, userId: user.id },
    include: {
      items: { select: { id: true, titleSnapshot: true, pricePaise: true, productId: true } },
      invoice: { select: { invoiceNo: true } },
    },
  });
  if (!order) notFound();

  const org = await db.organization.findUnique({
    where: { id: tenant.organizationId },
    select: { name: true, brandColor: true, supportEmail: true, contactNumber: true },
  });

  // Already paid, from an earlier attempt or a webhook that landed first.
  if (order.status === 'PAID') {
    const productId = order.items[0]?.productId;
    return (
      <Shell title="You are enrolled">
        <p className="muted">
          Payment received against order {order.orderNo}
          {order.invoice ? `, invoice ${order.invoice.invoiceNo}` : ''}.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href={productId ? `/learn/${productId}` : '/learn'}
            className="inline-flex h-11 items-center rounded-[var(--radius-sm)] px-5 text-sm font-medium text-[var(--brand-ink)]"
            style={{ background: 'var(--brand)' }}
          >
            Start learning
          </Link>
          <Link
            href="/learn/purchases"
            className="inline-flex h-11 items-center rounded-[var(--radius-sm)] border bg-[var(--surface)] px-5 text-sm font-medium"
          >
            View invoice
          </Link>
        </div>
      </Shell>
    );
  }

  if (!config || !order.gatewayOrderId) {
    return (
      <Shell title="Payment is not available">
        <p className="muted">
          This order exists, but the payment gateway is not configured on this site yet.
          {org?.supportEmail ? ` Write to ${org.supportEmail} and the academy will complete it.` : ''}
        </p>
      </Shell>
    );
  }

  const taxable = order.subtotalPaise - order.discountPaise;

  return (
    <Shell title="Complete your enrolment">
      <div className="rounded-[var(--radius)] border bg-[var(--surface)] p-6">
        <p className="t-small faint">Order {order.orderNo}</p>

        <ul className="mt-4 space-y-2">
          {order.items.map((i) => (
            <li key={i.id} className="flex items-baseline justify-between gap-4">
              <span className="text-sm">{i.titleSnapshot}</span>
              <span className="text-sm tabular-nums">{formatMoney(i.pricePaise, order.currency)}</span>
            </li>
          ))}
        </ul>

        <dl className="mt-5 space-y-1.5 border-t pt-4">
          <Line label="Taxable value" value={formatMoney(taxable, order.currency)} />
          {order.taxPaise > 0 && (
            <Line label="GST" value={formatMoney(order.taxPaise, order.currency)} />
          )}
          <div className="flex items-baseline justify-between gap-4 border-t pt-3">
            <dt className="font-medium">Total</dt>
            <dd className="text-lg font-semibold tabular-nums">
              {formatMoney(order.totalPaise, order.currency)}
            </dd>
          </div>
        </dl>

        <div className="mt-6">
          <PayNow
            orderId={order.id}
            gatewayOrderId={order.gatewayOrderId}
            keyId={config.keyId}
            testMode={config.isTestMode}
            amountPaise={order.totalPaise}
            currency={order.currency}
            organizationName={org?.name ?? 'Academy'}
            brandColor={org?.brandColor ?? '#087447'}
            learnerName={user.name}
            learnerEmail={user.email}
            productId={order.items[0]?.productId ?? null}
          />
        </div>

        <p className="t-small faint mt-4">
          Your card details are entered on Razorpay and never reach this site. Access is granted
          only after the payment is confirmed with the gateway, not when this page says so.
        </p>
      </div>
    </Shell>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="t-small muted">{label}</dt>
      <dd className="t-small tabular-nums">{value}</dd>
    </div>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-xl px-4 py-16 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <div className="mt-6">{children}</div>
    </main>
  );
}
