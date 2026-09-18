import { test } from 'node:test';
import assert from 'node:assert/strict';
import { failedOrders, inFlightFor, instalmentState, payOffer, processingOrders } from '../src/lib/parent-fees';

const now = new Date('2026-09-18T10:00:00Z');
const orders = [
  { id: 'o1', status: 'PENDING', gatewayOrderId: 'rzp_1', items: [{ instalmentId: 'i2', miscFeeId: null }] },
  { id: 'o2', status: 'PENDING', gatewayOrderId: null, items: [{ instalmentId: 'i3', miscFeeId: null }] },
  { id: 'o3', status: 'FAILED', gatewayOrderId: 'rzp_3', items: [{ instalmentId: null, miscFeeId: 'f1' }] },
  { id: 'o4', status: 'CANCELLED', gatewayOrderId: 'rzp_4', items: [{ instalmentId: 'i2', miscFeeId: null }] },
  { id: 'o5', status: 'PENDING', gatewayOrderId: 'rzp_5', items: [{ instalmentId: null, miscFeeId: 'f1' }] },
];

test('only a pending order the gateway has been handed counts as processing', () => {
  assert.deepEqual(processingOrders(orders).map((o) => o.id), ['o1', 'o5']);
  assert.deepEqual(failedOrders(orders).map((o) => o.id), ['o3', 'o4']);
});

test('an in-flight order is found by its instalment or its charge, never by a failed attempt', () => {
  assert.equal(inFlightFor(orders, { instalmentId: 'i2' })?.id, 'o1');
  assert.equal(inFlightFor(orders, { instalmentId: 'i3' }), null);
  assert.equal(inFlightFor(orders, { miscFeeId: 'f1' })?.id, 'o5');
  assert.equal(inFlightFor(orders, { instalmentId: null, miscFeeId: null }), null);
});

test('an instalment row says paid, processing, part paid, overdue or due, in that order of precedence', () => {
  const past = new Date('2026-09-01T00:00:00Z');
  const future = new Date('2026-10-01T00:00:00Z');
  assert.equal(instalmentState({ amountPaise: 1000, paidPaise: 1000, dueDate: past }, true, now), 'paid');
  assert.equal(instalmentState({ amountPaise: 1000, paidPaise: 0, dueDate: past }, true, now), 'processing');
  assert.equal(instalmentState({ amountPaise: 1000, paidPaise: 400, dueDate: past }, false, now), 'part-paid');
  assert.equal(instalmentState({ amountPaise: 1000, paidPaise: 0, dueDate: past }, false, now), 'overdue');
  assert.equal(instalmentState({ amountPaise: 1000, paidPaise: 0, dueDate: future }, false, now), 'due');
});

test('the Pay button is offered once, never while a payment is processing, and never without a gateway', () => {
  const next = { amountPaise: 1000, paidPaise: 0 };
  assert.equal(payOffer({ next: null, inFlight: false, online: true }), 'nothing-due');
  assert.equal(payOffer({ next: { amountPaise: 1000, paidPaise: 1000 }, inFlight: false, online: true }), 'nothing-due');
  assert.equal(payOffer({ next, inFlight: true, online: true }), 'processing');
  assert.equal(payOffer({ next, inFlight: false, online: false }), 'at-academy');
  assert.equal(payOffer({ next, inFlight: false, online: true }), 'pay-online');
});
