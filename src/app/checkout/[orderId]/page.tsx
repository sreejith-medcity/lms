import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { formatMoney } from '@/lib/money';
import { razorpayConfig } from '@/lib/razorpay';
import { settingBool, settingNumber } from '@/lib/settings/store';
import { estimatedGatewayFeePaise } from '@/lib/payment-amount';
import { CART_COOKIE } from '@/lib/cart-cookie';
import { contactOf, mayViewOrder } from '@/lib/guest-order';
import { PayNow } from './pay-now';
import { SetPassword } from './set-password';
import { TrackEvent } from '@/components/track-event';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Checkout', robots: { index: false, follow: false } };

export default async function CheckoutPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const tenant = await requireTenant();
  const user = await getSessionUser();

  const config = razorpayConfig();

  const order = await db.order.findFirst({
    where: { id: orderId, organizationId: tenant.organizationId },
    include: {
      items: { select: { id: true, titleSnapshot: true, pricePaise: true, productId: true } },
      invoice: { select: { invoiceNo: true } },
      promo: { select: { code: true } },
      user: { select: { id: true, name: true, email: true, passwordHash: true } },
    },
  });
  if (!order) notFound();

  /*
   * Two people may open this page: the learner it belongs to, and the browser
   * that bought it as a guest and has no account password yet. Anybody else
   * is sent to sign in, which is also what a stale link gets.
   */
  const cartCookie = (await cookies()).get(CART_COOKIE)?.value ?? null;
  const allowed = mayViewOrder({
    orderUserId: order.userId,
    sessionUserId: user?.id ?? null,
    orderBillingAddress: order.billingAddress,
    cartCookie,
  });
  if (!allowed) redirect(`/login?next=${encodeURIComponent(`/checkout/${orderId}`)}`);

  const contact = contactOf(order.billingAddress);
  const buyer = {
    name: order.user.name || contact.name || 'Learner',
    email: order.user.email ?? contact.email ?? null,
  };
  /* A buyer who has never set one is offered it here rather than emailed a
     link, because no email provider is connected yet and a purchase that
     depends on one is a purchase nobody can finish. */
  const needsPassword = !order.user.passwordHash;

  const org = await db.organization.findUnique({
    where: { id: tenant.organizationId },
    select: { name: true, brandColor: true, supportEmail: true, contactNumber: true },
  });

  const trackItems = order.items.map((i) => ({ id: i.productId, name: i.titleSnapshot, pricePaise: i.pricePaise }));

  // Already paid, from an earlier attempt or a webhook that landed first.
  if (order.status === 'PAID') {
    const productId = order.items[0]?.productId;
    return (
      <Shell title="You are enrolled">
        <TrackEvent
          once={`purchase:${order.orderNo}`}
          event={{
            name: 'purchase',
            items: trackItems,
            currency: order.currency,
            valuePaise: order.totalPaise,
            taxPaise: order.taxPaise,
            transactionId: order.orderNo,
            eventId: order.orderNo,
          }}
        />
        <p className="muted">
          Payment received against order {order.orderNo}
          {order.invoice ? `, invoice ${order.invoice.invoiceNo}` : ''}.
        </p>

        {needsPassword && Boolean(user) && (
          <div className="mt-6">
            <SetPassword email={buyer.email} />
          </div>
        )}
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

  // Where the academy's gateway account charges its fee to the buyer, the
  // card is charged more than the order. It is said here, before the payment
  // window opens, rather than discovered on a statement afterwards.
  const [customerBearsFee, feePercent] = await Promise.all([
    settingBool(tenant.organizationId, 'commerce.customerBearsGatewayFee'),
    settingNumber(tenant.organizationId, 'commerce.gatewayFeePercent'),
  ]);
  const gatewayFeePaise = customerBearsFee
    ? estimatedGatewayFeePaise(order.totalPaise, feePercent)
    : 0;

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
          {order.discountPaise > 0 && (
            <>
              <Line label="Subtotal" value={formatMoney(order.subtotalPaise, order.currency)} />
              <Line
                label={order.promo?.code ? `Discount (${order.promo.code})` : 'Discount'}
                value={`− ${formatMoney(order.discountPaise, order.currency)}`}
              />
            </>
          )}
          <Line label="Taxable value" value={formatMoney(taxable, order.currency)} />
          {order.taxPaise > 0 && (
            <Line label="GST" value={formatMoney(order.taxPaise, order.currency)} />
          )}
          {order.walletPaise > 0 && (
            <Line
              label="Paid with your credit"
              value={`− ${formatMoney(order.walletPaise, order.currency)}`}
            />
          )}
          <div className="flex items-baseline justify-between gap-4 border-t pt-3">
            <dt className="font-medium">Total</dt>
            <dd className="text-lg font-semibold tabular-nums">
              {formatMoney(order.totalPaise, order.currency)}
            </dd>
          </div>
        </dl>

        {gatewayFeePaise > 0 && (
          <div className="mt-4 rounded-[var(--radius-sm)] border border-dashed p-3">
            <div className="flex items-baseline justify-between gap-4">
              <span className="t-small muted">Payment gateway fee, added by the gateway</span>
              <span className="t-small tabular-nums">
                about {formatMoney(gatewayFeePaise, order.currency)}
              </span>
            </div>
            <div className="mt-1.5 flex items-baseline justify-between gap-4">
              <span className="t-small font-medium">Charged to your card</span>
              <span className="t-small font-semibold tabular-nums">
                about {formatMoney(order.totalPaise + gatewayFeePaise, order.currency)}
              </span>
            </div>
            <p className="t-small faint mt-1.5 leading-relaxed">
              The exact fee depends on how you pay, and UPI is usually the cheapest. Your invoice is
              for {formatMoney(order.totalPaise, order.currency)}, the course price.
            </p>
          </div>
        )}

        <TrackEvent
          once={`begin_checkout:${order.orderNo}`}
          event={{
            name: 'begin_checkout',
            items: trackItems,
            currency: order.currency,
            valuePaise: order.totalPaise,
            eventId: order.orderNo,
          }}
        />

        <div className="mt-6">
          <PayNow
            orderId={order.id}
            orderNo={order.orderNo}
            taxPaise={order.taxPaise}
            items={trackItems}
            gatewayOrderId={order.gatewayOrderId}
            keyId={config.keyId}
            testMode={config.isTestMode}
            amountPaise={order.totalPaise}
            currency={order.currency}
            organizationName={org?.name ?? 'Academy'}
            brandColor={org?.brandColor ?? '#322046'}
            learnerName={buyer.name}
            learnerEmail={buyer.email}
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
