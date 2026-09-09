import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { fulfilPaidOrder, recordFailedPayment } from '@/lib/fulfilment';
import { razorpayConfig, verifyWebhookSignature } from '@/lib/razorpay';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The authoritative path. Razorpay retries this until it gets a 2xx, which means
 * three things have to be true and are:
 *
 *   1. The body is verified against the raw bytes, before it is parsed.
 *   2. Every delivery is recorded, whether or not it can be processed, so a
 *      missed or out-of-order event can be replayed from the table rather than
 *      being reconstructed from a log file.
 *   3. Processing is idempotent, so the fourth delivery of a captured payment
 *      changes nothing and still answers 200. Answering anything else would make
 *      Razorpay retry forever.
 *
 * A signature failure gets a 400 and is still recorded, because a stream of them
 * is worth seeing.
 */
export async function POST(request: Request) {
  const config = razorpayConfig();
  if (!config) return NextResponse.json({ error: 'Not configured' }, { status: 503 });

  const raw = await request.text();
  const signature = request.headers.get('x-razorpay-signature') ?? '';
  const eventId = request.headers.get('x-razorpay-event-id') ?? `unsigned-${Date.now()}`;

  const signatureOk = config.webhookSecret ? verifyWebhookSignature(raw, signature) : false;

  let payload: RazorpayWebhook | null = null;
  try {
    payload = JSON.parse(raw) as RazorpayWebhook;
  } catch {
    return NextResponse.json({ error: 'Malformed body' }, { status: 400 });
  }

  const entity =
    payload.payload?.payment?.entity ?? payload.payload?.refund?.entity ?? null;
  const organizationId =
    (entity?.notes?.organizationId as string | undefined) ??
    (payload.payload?.order?.entity?.notes?.organizationId as string | undefined) ??
    null;

  // Recorded first, always. If everything below fails, the delivery survives.
  const record = await db.gatewayEvent.upsert({
    where: { gateway_eventId: { gateway: 'RAZORPAY', eventId } },
    create: {
      organizationId: organizationId ?? 'unknown',
      gateway: 'RAZORPAY',
      eventId,
      event: payload.event ?? 'unknown',
      payload: payload as object,
      signatureOk,
    },
    update: {},
    select: { id: true, processedAt: true },
  });

  if (!signatureOk) {
    await db.gatewayEvent.update({
      where: { id: record.id },
      data: { error: config.webhookSecret ? 'BAD_SIGNATURE' : 'NO_WEBHOOK_SECRET_SET' },
    });
    return NextResponse.json({ error: 'Signature check failed' }, { status: 400 });
  }

  // Already handled. Razorpay is retrying; tell it we are fine.
  if (record.processedAt) return NextResponse.json({ ok: true, duplicate: true });

  try {
    const handled = await handle(payload);
    await db.gatewayEvent.update({
      where: { id: record.id },
      data: { processedAt: new Date(), error: handled ? null : 'IGNORED' },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[razorpay/webhook]', payload.event, message);
    await db.gatewayEvent.update({ where: { id: record.id }, data: { error: message } });
    // A 500 asks Razorpay to retry, which is what we want for a transient fault.
    return NextResponse.json({ error: 'Could not process' }, { status: 500 });
  }
}

async function handle(payload: RazorpayWebhook): Promise<boolean> {
  const payment = payload.payload?.payment?.entity;

  if (payload.event === 'payment.captured' || payload.event === 'order.paid') {
    if (!payment) return false;

    // The order is found by the gateway's own order id rather than by trusting
    // the notes, so a forged note cannot point us at someone else's order.
    const order = payment.order_id
      ? await db.order.findFirst({
          where: { gatewayOrderId: payment.order_id },
          select: { id: true, organizationId: true },
        })
      : null;
    if (!order) return false;

    const result = await fulfilPaidOrder({
      organizationId: order.organizationId,
      orderId: order.id,
      gatewayPaymentId: payment.id,
      amountPaise: payment.amount,
      method: payment.method ?? null,
      raw: payment,
    });
    if (!result.ok) throw new Error(result.error ?? 'FULFILMENT_FAILED');
    return true;
  }

  if (payload.event === 'payment.failed') {
    if (!payment) return false;
    const order = payment.order_id
      ? await db.order.findFirst({
          where: { gatewayOrderId: payment.order_id },
          select: { id: true, organizationId: true, userId: true },
        })
      : null;
    if (!order) return false;

    await recordFailedPayment({
      organizationId: order.organizationId,
      orderId: order.id,
      userId: order.userId,
      gatewayPaymentId: payment.id,
      amountPaise: payment.amount,
      reason: payment.error_description ?? null,
      raw: payment,
    });
    return true;
  }

  if (payload.event === 'refund.processed' || payload.event === 'refund.created') {
    const refund = payload.payload?.refund?.entity;
    if (!refund?.payment_id) return false;

    const existing = await db.payment.findFirst({
      where: { gateway: 'RAZORPAY', gatewayRef: refund.payment_id },
      select: { id: true, amountPaise: true, orderId: true },
    });
    if (!existing) return false;

    const full = refund.amount >= existing.amountPaise;

    await db.refund.upsert({
      where: { id: refund.id },
      create: {
        id: refund.id,
        paymentId: existing.id,
        amountPaise: refund.amount,
        gatewayRef: refund.id,
        status: 'PROCESSED',
      },
      update: { status: 'PROCESSED' },
    });

    await db.payment.update({
      where: { id: existing.id },
      data: { status: full ? 'REFUNDED' : 'PARTIALLY_REFUNDED' },
    });

    if (full && existing.orderId) {
      await db.order.update({ where: { id: existing.orderId }, data: { status: 'REFUNDED' } });

      // Access ends. The enrolment, its progress and its attendance are history
      // and stay exactly where they are.
      await db.enrollment.updateMany({
        where: { orderItemId: { in: await orderItemIds(existing.orderId) }, status: 'ENROLLED' },
        data: { status: 'EXPIRED', expiresAt: new Date() },
      });
    }
    return true;
  }

  return false;
}

async function orderItemIds(orderId: string): Promise<string[]> {
  const items = await db.orderItem.findMany({ where: { orderId }, select: { id: true } });
  return items.map((i) => i.id);
}

interface RazorpayEntity {
  id: string;
  amount: number;
  order_id?: string | null;
  payment_id?: string;
  method?: string | null;
  error_description?: string | null;
  notes?: Record<string, unknown>;
}

interface RazorpayWebhook {
  event?: string;
  payload?: {
    payment?: { entity?: RazorpayEntity };
    order?: { entity?: RazorpayEntity };
    refund?: { entity?: RazorpayEntity };
  };
}
