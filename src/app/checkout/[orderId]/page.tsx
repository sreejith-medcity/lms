import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { formatMoney } from '@/lib/money';
import { razorpayConfig } from '@/lib/razorpay';
import { GATEWAY_LABEL, gatewayChoice, prepareOrder } from '@/lib/payments';
import { settingBool, settingNumber } from '@/lib/settings/store';
import { estimatedGatewayFeePaise } from '@/lib/payment-amount';
import { CART_COOKIE } from '@/lib/cart-cookie';
import { contactOf, mayViewOrder } from '@/lib/guest-order';
import { parentOfOrder } from '@/lib/parent-order';
import { PayNow } from './pay-now';
import { SetPassword } from './set-password';
import { TrackEvent } from '@/components/track-event';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Checkout', robots: { index: false, follow: false } };

export default async function CheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ failed?: string; pending?: string }>;
}) {
  const { orderId } = await params;
  const { failed, pending } = await searchParams;
  const tenant = await requireTenant();
  const user = await getSessionUser();

  const config = razorpayConfig();
  const choice = await gatewayChoice(tenant.organizationId);

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
   * Three people may open this page: the learner it belongs to, the browser
   * that bought it as a guest and has no account password yet, and a parent
   * linked to the learner, paying a fee on their behalf. Anybody else is sent
   * to sign in, which is also what a stale link gets. The parent is found by
   * their own session, not the query string: the query string only says where
   * to go back to.
   */
  const cartCookie = (await cookies()).get(CART_COOKIE)?.value ?? null;
  const parent = user ? null : await parentOfOrder(tenant.organizationId, order.userId);
  const allowed =
    parent !== null ||
    mayViewOrder({
      orderUserId: order.userId,
      sessionUserId: user?.id ?? null,
      orderBillingAddress: order.billingAddress,
      cartCookie,
    });
  if (!allowed) redirect(`/login?next=${encodeURIComponent(`/checkout/${orderId}`)}`);
  const backToFees = parent ? `/parent/${parent.childId}/fees` : null;

  const contact = contactOf(order.billingAddress);
  const buyer = {
    name: order.user.name || contact.name || 'Learner',
    email: order.user.email ?? contact.email ?? null,
  };
  /* A buyer who has never set one is offered it here rather than emailed a
     link, because no email provider is connected yet and a purchase that
     depends on one is a purchase nobody can finish. A parent is never
     offered the child's password. */
  const needsPassword = !order.user.passwordHash && !parent;

  const org = await db.organization.findUnique({
    where: { id: tenant.organizationId },
    select: { name: true, brandColor: true, supportEmail: true, contactNumber: true },
  });

  const trackItems = order.items.map((i) => ({ id: i.productId, name: i.titleSnapshot, pricePaise: i.pricePaise }));

  // Already paid, from an earlier attempt or a webhook that landed first.
  if (order.status === 'PAID' && parent) {
    return (
      <Shell title="Payment received">
        <p className="muted">
          Payment received for {order.user.name || 'your child'} against order {order.orderNo}
          {order.invoice ? `, invoice ${order.invoice.invoiceNo}` : ''}. The receipt appears on the fees page once it is issued.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href={backToFees ?? '/parent'}
            className="inline-flex h-11 items-center rounded-[var(--radius-sm)] px-5 text-sm font-medium text-[var(--brand-ink)]"
            style={{ background: 'var(--brand)' }}
          >
            Back to fees
          </Link>
        </div>
      </Shell>
    );
  }

  if (order.status === 'PAID') {
    const productId = order.items[0]?.productId;
    /* An order of test packs only: papers to sit, not a course to open. */
    const kinds = await db.product.findMany({ where: { organizationId: tenant.organizationId, id: { in: order.items.map((i) => i.productId) } }, select: { type: true } });
    const papersOnly = kinds.length > 0 && kinds.every((k) => k.type === 'TEST_SERIES');
    return (
      <Shell title={papersOnly ? 'Your papers are ready' : 'You are enrolled'}>
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
            href={papersOnly ? '/learn/tests' : productId ? `/learn/${productId}` : '/learn'}
            className="inline-flex h-11 items-center rounded-[var(--radius-sm)] px-5 text-sm font-medium text-[var(--brand-ink)]"
            style={{ background: 'var(--brand)' }}
          >
            {papersOnly ? 'Go to my tests' : 'Start learning'}
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

  // Which button to show: the gateway the order was prepared for, or the
  // academy's choice now. Razorpay needs its order id to open the window.
  const primary = choice.primary ?? (choice.international ? 'stripe' : null);
  // A Razorpay order is minted when the order is written; after a detour to
  // another gateway (a Stripe attempt that was cancelled) it is minted again,
  // so the window never opens on another gateway's id.
  let razorpayOrderId = order.gateway === 'razorpay' ? order.gatewayOrderId : null;
  if (primary === 'razorpay' && config && !razorpayOrderId) {
    await prepareOrder(tenant.organizationId, order).catch(() => null);
    razorpayOrderId = (await db.order.findUnique({ where: { id: order.id }, select: { gatewayOrderId: true } }))?.gatewayOrderId ?? null;
  }
  const razorpayReady = primary === 'razorpay' && Boolean(config) && Boolean(razorpayOrderId);
  const redirectReady = primary !== null && primary !== 'razorpay';
  const offerStripe = choice.international === 'stripe' && primary !== 'stripe';

  if (!razorpayReady && !redirectReady) {
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
  const [customerBearsFee, feePercent, emiNote] = await Promise.all([
    settingBool(tenant.organizationId, 'commerce.customerBearsGatewayFee'),
    settingNumber(tenant.organizationId, 'commerce.gatewayFeePercent'),
    settingBool(tenant.organizationId, 'payments.emiNote'),
  ]);
  const failedNote =
    failed === 'cancelled'
      ? 'The payment was cancelled. Nothing was charged; you can try again.'
      : failed === 'payment'
        ? 'The payment did not go through. Nothing was charged; you can try again or pay another way.'
        : failed === 'start'
          ? 'The payment page could not be opened just now. Please try again in a moment.'
          : failed
            ? 'We could not confirm the payment yet. If money left your account, it will be matched to this order shortly; do not pay twice.'
            : null;
  const pendingNote = pending ? 'The gateway is still confirming your payment. This page updates once it does; do not pay again.' : null;
  const gatewayFeePaise = customerBearsFee
    ? estimatedGatewayFeePaise(order.totalPaise, feePercent)
    : 0;

  return (
    <Shell title={parent ? `Pay for ${order.user.name || 'your child'}` : 'Complete your enrolment'}>
      <div className="rounded-[var(--radius)] border bg-[var(--surface)] p-6">
        <p className="t-small faint">
          Order {order.orderNo}
          {backToFees && (
            <>
              {' · '}
              <Link href={backToFees} className="underline">
                back to fees
              </Link>
            </>
          )}
        </p>

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

        {failedNote && (
          <p className="mt-4 rounded-[var(--radius-sm)] border px-3 py-2 text-sm" style={{ background: 'var(--warn-soft)', borderColor: 'var(--warn)' }}>
            {failedNote}
          </p>
        )}
        {pendingNote && (
          <p className="mt-4 rounded-[var(--radius-sm)] border px-3 py-2 text-sm" style={{ background: 'var(--surface-2)' }}>
            {pendingNote}
          </p>
        )}
        {emiNote && <p className="t-small muted mt-4">Paying by card? EMI options appear in the payment window for cards that support it.</p>}

        <div className="mt-6">
          {razorpayReady && config && razorpayOrderId ? (
            <PayNow
              orderId={order.id}
              orderNo={order.orderNo}
              taxPaise={order.taxPaise}
              items={trackItems}
              gatewayOrderId={razorpayOrderId}
              keyId={config.keyId}
              testMode={config.isTestMode}
              amountPaise={order.totalPaise}
              currency={order.currency}
              organizationName={org?.name ?? 'Academy'}
              brandColor={org?.brandColor ?? '#322046'}
              learnerName={buyer.name}
              learnerEmail={buyer.email}
              productId={order.items[0]?.productId ?? null}
              returnTo={backToFees}
            />
          ) : (
            primary && (
              <form method="post" action={`/api/payments/${primary}/start`}>
                <input type="hidden" name="orderId" value={order.id} />
                <button
                  type="submit"
                  className="inline-flex h-12 w-full items-center justify-center rounded-[var(--radius-sm)] text-base font-semibold text-[var(--brand-ink)]"
                  style={{ background: 'var(--brand)' }}
                >
                  Pay {formatMoney(order.totalPaise, order.currency)} with {GATEWAY_LABEL[primary]}
                </button>
              </form>
            )
          )}
          {offerStripe && (
            <form method="post" action="/api/payments/stripe/start" className="mt-3">
              <input type="hidden" name="orderId" value={order.id} />
              <button
                type="submit"
                className="inline-flex h-11 w-full items-center justify-center rounded-[var(--radius-sm)] border bg-[var(--surface)] text-sm font-medium"
              >
                Paying from outside India? Pay by card through Stripe
              </button>
            </form>
          )}
        </div>

        <p className="t-small faint mt-4">
          Your card details are entered on {primary ? GATEWAY_LABEL[primary] : 'the gateway'}{offerStripe ? ' or Stripe' : ''} and never reach this site. Access is granted
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
