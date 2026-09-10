import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contactOf, guestTokenOf, mayViewOrder } from '../src/lib/guest-order';

const TOKEN = 'abcdefghijklmnopqrstuvwx';

test('the buyer sees their own order', () => {
  assert.equal(
    mayViewOrder({ orderUserId: 'u1', sessionUserId: 'u1', orderBillingAddress: null }),
    true,
  );
});

test('another signed-in learner does not', () => {
  assert.equal(
    mayViewOrder({ orderUserId: 'u1', sessionUserId: 'u2', orderBillingAddress: null }),
    false,
  );
});

test('the browser that paid as a guest sees the order it paid for', () => {
  assert.equal(
    mayViewOrder({
      orderUserId: 'u1',
      sessionUserId: null,
      orderBillingAddress: { guestToken: TOKEN, email: 'a@b.com' },
      cartCookie: TOKEN,
    }),
    true,
  );
});

test('a different browser does not, and neither does no cookie at all', () => {
  for (const cookie of ['someone-elses-token-value', '', null, undefined]) {
    assert.equal(
      mayViewOrder({
        orderUserId: 'u1',
        sessionUserId: null,
        orderBillingAddress: { guestToken: TOKEN },
        cartCookie: cookie,
      }),
      false,
      String(cookie),
    );
  }
});

test('an order with no guest token is never opened by a cookie', () => {
  for (const billing of [null, {}, { guestToken: '' }, { guestToken: 'short' }, ['x'], 'nope']) {
    assert.equal(
      mayViewOrder({
        orderUserId: 'u1',
        sessionUserId: null,
        orderBillingAddress: billing,
        cartCookie: TOKEN,
      }),
      false,
      JSON.stringify(billing),
    );
  }
});

test('a token has to be long enough to be one', () => {
  assert.equal(guestTokenOf({ guestToken: 'x'.repeat(16) }), 'x'.repeat(16));
  assert.equal(guestTokenOf({ guestToken: 'x'.repeat(15) }), null);
  assert.equal(guestTokenOf({ guestToken: 42 }), null);
  assert.equal(guestTokenOf(undefined), null);
});

test('contact details come back as strings or not at all', () => {
  assert.deepEqual(contactOf({ name: 'Anu', email: 'a@b.com', phone: '9847012345', junk: 1 }), {
    name: 'Anu',
    email: 'a@b.com',
    phone: '9847012345',
  });
  assert.deepEqual(contactOf({ name: 12 }), { name: undefined, email: undefined, phone: undefined });
  assert.deepEqual(contactOf(null), {});
});
