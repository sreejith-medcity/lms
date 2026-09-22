import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEST_URL, makeAcademy, makeOrder } from './fixture';

/**
 * The money path against a real database. What a mock cannot tell you:
 * that the second webhook for the same payment finds the unique index
 * and enrols nobody twice, that a mismatch leaves a written refusal and
 * an unattached payment, and that a refund ends access without touching
 * history.
 */
const skip = TEST_URL ? false : 'TEST_DATABASE_URL is not set, so the database-backed tests are skipped.';

test('a paid order enrols once however many times the gateway says so', { skip }, async () => {
  const { db } = await import('../../src/lib/db');
  const { fulfilPaidOrder } = await import('../../src/lib/fulfilment');
  const a = await makeAcademy();
  try {
    const { orderId } = await makeOrder(a);
    const first = await fulfilPaidOrder({ organizationId: a.organizationId, orderId, gatewayPaymentId: 'pay_once', amountPaise: 1_000_000 });
    assert.equal(first.ok, true, first.error);
    assert.equal(first.alreadyDone, false);
    assert.equal(first.enrollmentIds.length, 1);
    assert.ok(first.invoiceNo, 'an invoice is numbered');

    const again = await fulfilPaidOrder({ organizationId: a.organizationId, orderId, gatewayPaymentId: 'pay_once', amountPaise: 1_000_000 });
    assert.equal(again.ok, true, again.error);
    assert.equal(again.alreadyDone, true);
    assert.deepEqual(again.enrollmentIds, first.enrollmentIds);

    assert.equal(await db.enrollment.count({ where: { organizationId: a.organizationId, userId: a.learnerId } }), 1);
    assert.equal(await db.payment.count({ where: { organizationId: a.organizationId, gateway: 'RAZORPAY', gatewayRef: 'pay_once' } }), 1);
    const order = await db.order.findUnique({ where: { id: orderId }, select: { status: true, invoice: { select: { invoiceNo: true } } } });
    assert.equal(order?.status, 'PAID');
    assert.equal(order?.invoice?.invoiceNo, first.invoiceNo);
  } finally {
    await a.drop();
  }
});

test('an amount that does not reconcile grants nothing and is written down', { skip }, async () => {
  const { db } = await import('../../src/lib/db');
  const { fulfilPaidOrder } = await import('../../src/lib/fulfilment');
  const a = await makeAcademy();
  try {
    const { orderId } = await makeOrder(a);
    const r = await fulfilPaidOrder({ organizationId: a.organizationId, orderId, gatewayPaymentId: 'pay_short', amountPaise: 900_000 });
    assert.equal(r.ok, false);
    assert.match(r.error ?? '', /AMOUNT_MISMATCH/);
    assert.equal(r.enrollmentIds.length, 0);
    assert.equal(await db.enrollment.count({ where: { organizationId: a.organizationId, userId: a.learnerId } }), 0);
    const order = await db.order.findUnique({ where: { id: orderId }, select: { status: true } });
    assert.notEqual(order?.status, 'PAID');
    const refusal = await db.gatewayEvent.findFirst({ where: { organizationId: a.organizationId, event: 'fulfilment.refused' }, select: { error: true } });
    assert.equal(refusal?.error, 'AMOUNT_MISMATCH');
    // The money is never invisible: the payment is on record, just not attached to access.
    const payment = await db.payment.findFirst({ where: { organizationId: a.organizationId, gatewayRef: 'pay_short' }, select: { status: true, amountPaise: true } });
    assert.ok(payment, 'the short payment was recorded');
    assert.notEqual(payment?.status, 'CAPTURED');
  } finally {
    await a.drop();
  }
});

test('a full refund ends access and keeps the history', { skip }, async () => {
  const { db } = await import('../../src/lib/db');
  const { applyGatewayRefund, fulfilPaidOrder } = await import('../../src/lib/fulfilment');
  const a = await makeAcademy();
  try {
    const { orderId } = await makeOrder(a);
    const paid = await fulfilPaidOrder({ organizationId: a.organizationId, orderId, gatewayPaymentId: 'pay_back', amountPaise: 1_000_000 });
    assert.equal(paid.ok, true, paid.error);

    const part = await applyGatewayRefund({ organizationId: a.organizationId, gateway: 'RAZORPAY', gatewayPaymentId: 'pay_back', refundId: 'rfnd_part', amountPaise: 100_000 });
    assert.deepEqual(part, { applied: true, full: false, expired: 0 });
    assert.equal((await db.payment.findFirst({ where: { organizationId: a.organizationId, gatewayRef: 'pay_back' } }))?.status, 'PARTIALLY_REFUNDED');
    assert.equal((await db.enrollment.findFirst({ where: { id: paid.enrollmentIds[0] } }))?.status, 'ENROLLED');

    const full = await applyGatewayRefund({ organizationId: a.organizationId, gateway: 'RAZORPAY', gatewayPaymentId: 'pay_back', refundId: 'rfnd_full', amountPaise: 1_000_000 });
    assert.deepEqual(full, { applied: true, full: true, expired: 1 });
    // The same webhook again writes nothing new.
    const twice = await applyGatewayRefund({ organizationId: a.organizationId, gateway: 'RAZORPAY', gatewayPaymentId: 'pay_back', refundId: 'rfnd_full', amountPaise: 1_000_000 });
    assert.equal(twice.applied, true);
    assert.equal(await db.refund.count({ where: { id: 'rfnd_full' } }), 1);

    assert.equal((await db.payment.findFirst({ where: { organizationId: a.organizationId, gatewayRef: 'pay_back' } }))?.status, 'REFUNDED');
    assert.equal((await db.order.findUnique({ where: { id: orderId } }))?.status, 'REFUNDED');
    const enrolment = await db.enrollment.findUnique({ where: { id: paid.enrollmentIds[0] }, select: { status: true, expiresAt: true } });
    assert.equal(enrolment?.status, 'EXPIRED');
    assert.ok(enrolment?.expiresAt && enrolment.expiresAt <= new Date());
    // History: the enrolment row is still there, not deleted.
    assert.equal(await db.enrollment.count({ where: { organizationId: a.organizationId, userId: a.learnerId } }), 1);

    const unknown = await applyGatewayRefund({ organizationId: a.organizationId, gateway: 'RAZORPAY', gatewayPaymentId: 'pay_nobody', refundId: 'rfnd_x', amountPaise: 1 });
    assert.equal(unknown.applied, false);
  } finally {
    await a.drop();
  }
});

test('a promo code capped at one use is honoured once, even when two claim it at the same instant', { skip }, async () => {
  const { db } = await import('../../src/lib/db');
  const { claimPromo, PromoRefused } = await import('../../src/lib/promo-claim');
  const a = await makeAcademy();
  try {
    const promo = await db.promoCode.create({ data: { organizationId: a.organizationId, code: 'FIRST1', discountType: 'PERCENT', discountValue: 10, maxRedemptions: 1, perUserLimit: 5 }, select: { id: true } });
    const claim = (who: string) =>
      db.$transaction(async (tx) => {
        const c = await claimPromo(tx, { organizationId: a.organizationId, rawCode: 'first1', userId: a.learnerId, productId: a.productId, subtotalPaise: 1_000_000 });
        await tx.promoRedemption.create({ data: { promoCodeId: c.promoCodeId as string, userId: a.learnerId, amountPaise: c.discountPaise } });
        return who;
      });
    const results = await Promise.allSettled([claim('one'), claim('two')]);
    const won = results.filter((r) => r.status === 'fulfilled');
    const lost = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    assert.equal(won.length, 1, 'exactly one claim gets in');
    assert.equal(lost.length, 1);
    assert.ok(lost[0].reason instanceof PromoRefused, 'the other is refused, not crashed');
    assert.equal((lost[0].reason as InstanceType<typeof PromoRefused>).reason, 'ALL_USED');
    assert.equal(await db.promoRedemption.count({ where: { promoCodeId: promo.id } }), 1);

    await assert.rejects(claim('three'), (err: unknown) => err instanceof PromoRefused && err.reason === 'ALL_USED');
  } finally {
    await a.drop();
  }
});
