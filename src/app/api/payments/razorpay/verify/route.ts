import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { getTenantContext } from '@/lib/tenant';
import { fetchRazorpayPayment, verifyCheckoutSignature } from '@/lib/razorpay';
import { fulfilPaidOrder, recordFailedPayment } from '@/lib/fulfilment';
import { CART_COOKIE } from '@/lib/cart-cookie';
import { mayViewOrder } from '@/lib/guest-order';
import { issueSession } from '@/lib/sign-in';


export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The browser's callback after Razorpay's modal closes.
 *
 * This is a convenience, not the source of truth. It checks the signature so the
 * caller cannot invent a payment, then asks Razorpay's API what actually
 * happened rather than believing the browser, and only then grants access. If
 * this request never arrives, because the learner closed the tab or lost signal,
 * the webhook does the same job a moment later and reaches the same state.
 */
export async function POST(request: Request) {
  const tenant = await getTenantContext();
  const user = await getSessionUser();
  if (!tenant) return NextResponse.json({ error: 'Not allowed' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    razorpay_order_id?: string;
    razorpay_payment_id?: string;
    razorpay_signature?: string;
    orderId?: string;
  } | null;

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, orderId } = body ?? {};
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !orderId) {
    return NextResponse.json({ error: 'Incomplete payment response' }, { status: 400 });
  }

  const order = await db.order.findFirst({
    where: { id: orderId, organizationId: tenant.organizationId },
    select: {
      id: true,
      gatewayOrderId: true,
      userId: true,
      billingAddress: true,
      user: { select: { passwordHash: true } },
    },
  });
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });

  // The learner it belongs to, or the browser that bought it as a guest.
  const cartCookie = (await cookies()).get(CART_COOKIE)?.value ?? null;
  const guest = !user;
  if (
    !mayViewOrder({
      orderUserId: order.userId,
      sessionUserId: user?.id ?? null,
      orderBillingAddress: order.billingAddress,
      cartCookie,
    })
  ) {
    return NextResponse.json({ error: 'Not allowed' }, { status: 401 });
  }

  // The signed order id has to be the one we created for this order. Without
  // this check a valid signature from any other order would pass.
  if (order.gatewayOrderId !== razorpay_order_id) {
    return NextResponse.json({ error: 'This payment belongs to a different order' }, { status: 400 });
  }

  if (
    !verifyCheckoutSignature({
      razorpayOrderId: razorpay_order_id,
      razorpayPaymentId: razorpay_payment_id,
      signature: razorpay_signature,
    })
  ) {
    return NextResponse.json({ error: 'That payment could not be verified' }, { status: 400 });
  }

  const payment = await fetchRazorpayPayment(razorpay_payment_id).catch(() => null);
  if (!payment) {
    return NextResponse.json(
      { error: 'We could not reach the gateway to confirm. Your access will appear shortly.' },
      { status: 202 },
    );
  }

  if (payment.status === 'failed') {
    await recordFailedPayment({
      organizationId: tenant.organizationId,
      orderId: order.id,
      userId: order.userId,
      gatewayPaymentId: payment.id,
      amountPaise: payment.amount,
      reason: payment.error_description ?? null,
      raw: payment,
    });
    return NextResponse.json({ error: payment.error_description ?? 'The payment failed.' }, { status: 400 });
  }

  if (payment.status !== 'captured') {
    // Authorised but not captured yet. The webhook will finish it.
    return NextResponse.json({ pending: true }, { status: 202 });
  }

  const result = await fulfilPaidOrder({
    organizationId: tenant.organizationId,
    orderId: order.id,
    gatewayPaymentId: payment.id,
    amountPaise: payment.amount,
    feePaise: payment.fee ?? null,
    method: payment.method ?? null,
    raw: payment,
  });

  if (!result.ok) {
    // The refusal is already written to gateway_events by fulfilPaidOrder, so the
    // academy can see it in the admin. The learner gets the reference to quote.
    return NextResponse.json(
      {
        error: `Your payment went through, but we could not finish your enrolment automatically. Nothing is lost: quote ${result.reference ?? 'this page'} to the academy and they can complete it.`,
        reference: result.reference,
      },
      { status: 500 },
    );
  }

  /*
   * The moment a guest becomes a learner.
   *
   * The session is issued here rather than at checkout, because at checkout
   * nothing had been proved: anybody can type an email address. Here the
   * gateway has confirmed the money against this order, and the account being
   * entered has no password, so nothing is being bypassed.
   */
  let claimed = false;
  if (guest && !order.user.passwordHash) {
    await issueSession(order.userId);
    claimed = true;
  }

  return NextResponse.json({
    ok: true,
    orderId: result.orderId,
    invoiceNo: result.invoiceNo,
    claimed,
  });
}
