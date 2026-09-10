import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocate, priceOrder, type DraftLine } from '../src/lib/order-lines';

const GST = {
  cgstPercent: 9,
  sgstPercent: 9,
  igstPercent: 18,
  interState: false,
  pricesAreExclusive: true,
  enabled: true,
};

function line(over: Partial<DraftLine> & { pricePaise: number }): DraftLine {
  return {
    productId: 'p',
    pricingPlanId: 'plan',
    title: 'Course',
    isPrimary: false,
    ...over,
  };
}

test('allocate always gives out exactly what it was given', () => {
  for (const [amount, weights] of [
    [100, [1, 1, 1]],
    [1, [1, 1]],
    [0, [5, 5]],
    [9163, [4500000, 590000]],
    [7, [1, 2, 3, 4]],
  ] as [number, number[]][]) {
    const out = allocate(amount, weights);
    assert.equal(
      out.reduce((n, v) => n + v, 0),
      amount,
      `${amount} across ${weights.join(',')} came back as ${out.join(',')}`,
    );
    assert.equal(out.length, weights.length);
  }
});

test('the odd paise goes to the biggest line, not the first one', () => {
  // 1 paise across a small line and a large one. Largest remainder puts it on
  // the large one, which is the line a rounding error is least visible on.
  assert.deepEqual(allocate(1, [1, 99]), [0, 1]);
  assert.deepEqual(allocate(1, [99, 1]), [1, 0]);
});

test('nothing to weigh by does not lose the money', () => {
  assert.deepEqual(allocate(500, [0, 0]), [500, 0]);
  assert.deepEqual(allocate(500, []), []);
});

test('a single line prices exactly as it did before add-ons existed', () => {
  const out = priceOrder({
    lines: [line({ pricePaise: 4500000, isPrimary: true })],
    discountPaise: 0,
    tax: GST,
  });
  assert.equal(out.subtotalPaise, 4500000);
  assert.equal(out.taxPaise, 810000);
  assert.equal(out.beforePointsPaise, 5310000);
  assert.equal(out.lines[0].totalPaise, 5310000);
});

test('the lines add back up to the order, to the paise', () => {
  const out = priceOrder({
    lines: [
      line({ productId: 'nclex', pricePaise: 5900033, isPrimary: true }),
      line({ productId: 'archer', pricePaise: 1233317 }),
    ],
    discountPaise: 0,
    tax: GST,
  });

  const summedTax = out.lines.reduce((n, l) => n + l.taxPaise, 0);
  const summedTotal = out.lines.reduce((n, l) => n + l.totalPaise, 0);
  assert.equal(summedTax, out.taxPaise);
  assert.equal(summedTotal, out.beforePointsPaise);
});

test('a promo code discounts the course, not the extra somebody ticked', () => {
  const out = priceOrder({
    lines: [
      line({ productId: 'nclex', pricePaise: 5900000, isPrimary: true }),
      line({ productId: 'archer', pricePaise: 1200000 }),
    ],
    discountPaise: 1000000,
    tax: GST,
  });

  assert.equal(out.lines[0].discountPaise, 1000000);
  assert.equal(out.lines[1].discountPaise, 0);
  // Tax is owed on 49,000 + 12,000 = 61,000, not on the list price.
  assert.equal(out.taxPaise, Math.round(6100000 * 0.18));
});

test('a discount larger than the course it applies to is capped, not carried', () => {
  const out = priceOrder({
    lines: [
      line({ productId: 'a', pricePaise: 100000, isPrimary: true }),
      line({ productId: 'b', pricePaise: 900000 }),
    ],
    discountPaise: 500000,
    tax: GST,
  });
  assert.equal(out.discountPaise, 100000);
  assert.equal(out.lines[1].discountPaise, 0);
});

test('tax switched off leaves the total at the net price', () => {
  const out = priceOrder({
    lines: [line({ pricePaise: 250000, isPrimary: true }), line({ pricePaise: 50000 })],
    discountPaise: 0,
    tax: { ...GST, enabled: false },
  });
  assert.equal(out.taxPaise, 0);
  assert.equal(out.beforePointsPaise, 300000);
  assert.equal(
    out.lines.reduce((n, l) => n + l.totalPaise, 0),
    300000,
  );
});

test('tax-inclusive pricing still has the lines summing to the total', () => {
  const out = priceOrder({
    lines: [line({ pricePaise: 999900, isPrimary: true }), line({ pricePaise: 333300 })],
    discountPaise: 0,
    tax: { ...GST, pricesAreExclusive: false },
  });
  // Inclusive means the buyer pays exactly what the page said. Carving the
  // tax out and adding it back lands a paise high, and the price wins.
  assert.equal(out.beforePointsPaise, 1333200);
  assert.equal(
    out.lines.reduce((n, l) => n + l.totalPaise, 0),
    out.beforePointsPaise,
  );
  assert.ok(out.taxPaise > 0);
});

test('an order with no primary line still prices, and discounts nothing', () => {
  const out = priceOrder({
    lines: [line({ pricePaise: 100000 })],
    discountPaise: 5000,
    tax: GST,
  });
  assert.equal(out.discountPaise, 0);
  assert.equal(out.lines[0].discountPaise, 0);
});
