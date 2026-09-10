import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewBasket, promoTarget, type BasketRow } from '../src/lib/cart-rules';

function row(over: Partial<BasketRow> & { itemId: string; productId: string }): BasketRow {
  return {
    title: `Course ${over.productId}`,
    slug: over.productId,
    pricingPlanId: `plan-${over.productId}`,
    planType: 'ONE_TIME',
    pricePaise: 500000,
    currency: 'INR',
    isAddonOnly: false,
    parentProductIds: [],
    status: 'PUBLISHED',
    onDemandOnly: false,
    ...over,
  };
}

test('two courses and an extra are one payable basket', () => {
  const review = reviewBasket([
    row({ itemId: 'i1', productId: 'german' }),
    row({ itemId: 'i2', productId: 'ielts', pricePaise: 300000 }),
    row({
      itemId: 'i3',
      productId: 'archer',
      pricePaise: 120000,
      isAddonOnly: true,
      parentProductIds: ['nclex', 'german'],
    }),
  ]);

  assert.equal(review.lines.length, 3);
  assert.equal(review.dropped.length, 0);
  assert.equal(review.subtotalPaise, 920000);
});

test('the same course added twice is charged once', () => {
  const review = reviewBasket([
    row({ itemId: 'i1', productId: 'german' }),
    row({ itemId: 'i2', productId: 'german' }),
  ]);

  assert.equal(review.lines.length, 1);
  assert.deepEqual(
    review.dropped.map((d) => d.reason),
    ['DUPLICATE'],
  );
  assert.equal(review.subtotalPaise, 500000);
});

test('an extra whose course is not in the basket does not travel alone', () => {
  const review = reviewBasket([
    row({
      itemId: 'i1',
      productId: 'archer',
      isAddonOnly: true,
      parentProductIds: ['nclex'],
    }),
  ]);

  assert.equal(review.lines.length, 0);
  assert.equal(review.dropped[0].reason, 'ADDON_WITHOUT_COURSE');
});

test('removing the course removes the extra with it, not the other way round', () => {
  const review = reviewBasket([
    row({ itemId: 'i1', productId: 'ielts' }),
    row({ itemId: 'i2', productId: 'archer', isAddonOnly: true, parentProductIds: ['nclex'] }),
  ]);

  assert.deepEqual(review.lines.map((l) => l.productId), ['ielts']);
});

test('a course already owned is taken out rather than sold twice', () => {
  const review = reviewBasket(
    [row({ itemId: 'i1', productId: 'german' }), row({ itemId: 'i2', productId: 'ielts' })],
    { enrolledProductIds: ['german'] },
  );

  assert.deepEqual(review.lines.map((l) => l.productId), ['ielts']);
  assert.equal(review.dropped[0].reason, 'ALREADY_ENROLLED');
});

test('an instalment plan is separated out, not silently charged in full', () => {
  const review = reviewBasket([
    row({ itemId: 'i1', productId: 'german', planType: 'INSTALMENT' }),
    row({ itemId: 'i2', productId: 'ielts' }),
  ]);

  assert.deepEqual(review.lines.map((l) => l.productId), ['ielts']);
  assert.equal(review.needsOwnCheckout.length, 1);
  assert.equal(review.needsOwnCheckout[0].productId, 'german');
  // It is reported separately from the ordinary removals, because the buyer
  // has to do something about it rather than just be told.
  assert.equal(review.dropped.length, 0);
});

test('an unpublished or free row never reaches the gateway', () => {
  const review = reviewBasket([
    row({ itemId: 'i1', productId: 'draft', status: 'DRAFT' }),
    row({ itemId: 'i2', productId: 'free', pricePaise: 0 }),
    row({ itemId: 'i3', productId: 'offline', onDemandOnly: true }),
  ]);

  assert.equal(review.lines.length, 0);
  assert.deepEqual(
    review.dropped.map((d) => d.reason).sort(),
    ['FREE', 'NOT_SOLD_ONLINE', 'UNAVAILABLE'],
  );
});

test('an empty basket is not an error', () => {
  const review = reviewBasket([]);
  assert.deepEqual(review.lines, []);
  assert.equal(review.subtotalPaise, 0);
  assert.equal(review.currency, 'INR');
});

test('every dropped row carries a sentence a buyer can act on', () => {
  const review = reviewBasket([
    row({ itemId: 'i1', productId: 'draft', status: 'ARCHIVED' }),
    row({ itemId: 'i2', productId: 'a', isAddonOnly: true, parentProductIds: ['x'] }),
  ]);

  for (const d of review.dropped) {
    assert.ok(d.message.length > 10, `${d.reason} has no message`);
    assert.ok(d.message.endsWith('.'), `${d.reason} message is not a sentence`);
  }
});

test('a promo code is quoted against the dearest course, never an extra', () => {
  const review = reviewBasket([
    row({ itemId: 'i1', productId: 'cheap', pricePaise: 100000 }),
    row({ itemId: 'i2', productId: 'dear', pricePaise: 900000 }),
    row({
      itemId: 'i3',
      productId: 'archer',
      pricePaise: 999999,
      isAddonOnly: true,
      parentProductIds: ['dear'],
    }),
  ]);

  assert.equal(promoTarget(review.lines)?.productId, 'dear');
});

test('a basket of extras alone has nothing to quote a code against', () => {
  assert.equal(promoTarget([]), null);
});
