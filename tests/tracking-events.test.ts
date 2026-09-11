import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dataLayerPayloads,
  ga4Payload,
  googleAdsConversion,
  metaPayload,
  type TrackEvent,
} from '../src/lib/tracking-events';

const purchase: TrackEvent = {
  name: 'purchase',
  items: [
    { id: 'p1', name: 'NCLEX-RN', pricePaise: 700000, category: 'Nursing' },
    { id: 'p2', name: 'Question bank', pricePaise: 126000 },
  ],
  currency: 'INR',
  valuePaise: 826000,
  taxPaise: 126000,
  transactionId: 'ORD-2026-00003',
  eventId: 'ORD-2026-00003',
};

test('a purchase in GA4 words: rupees, transaction id, items', () => {
  const ga = ga4Payload(purchase);
  assert.equal(ga.name, 'purchase');
  assert.equal(ga.params.transaction_id, 'ORD-2026-00003');
  assert.equal(ga.params.value, 8260);
  assert.equal(ga.params.tax, 1260);
  assert.deepEqual((ga.params.items as { item_id: string; price: number; item_category?: string }[]).map((i) => [i.item_id, i.price, i.item_category]), [
    ['p1', 7000, 'Nursing'],
    ['p2', 1260, undefined],
  ]);
});

test('the same purchase in Meta words carries the event id for dedup', () => {
  const m = metaPayload(purchase);
  assert.equal(m.name, 'Purchase');
  assert.equal(m.eventId, 'ORD-2026-00003');
  assert.deepEqual(m.params.content_ids, ['p1', 'p2']);
  assert.equal(m.params.value, 8260);
});

test('view and add-to-cart value the items themselves', () => {
  const view: TrackEvent = { name: 'view_item', items: [{ id: 'p1', name: 'IELTS', pricePaise: 1500000 }], currency: 'INR' };
  assert.equal(ga4Payload(view).params.value, 15000);
  assert.equal(metaPayload(view).name, 'ViewContent');
  assert.equal(metaPayload({ ...view, name: 'add_to_cart' }).name, 'AddToCart');
  assert.equal(metaPayload(view).eventId, undefined);
});

test('the dataLayer push clears the previous ecommerce object first', () => {
  const pushes = dataLayerPayloads(purchase);
  assert.deepEqual(pushes[0], { ecommerce: null });
  assert.equal(pushes[1].event, 'purchase');
  assert.equal(pushes[1].event_id, 'ORD-2026-00003');
  const ecommerce = pushes[1].ecommerce as { transaction_id: string; items: unknown[] };
  assert.equal(ecommerce.transaction_id, 'ORD-2026-00003');
  assert.equal(ecommerce.items.length, 2);

  const lead = dataLayerPayloads({ name: 'generate_lead', eventId: 'lead-1' });
  assert.deepEqual(lead, [{ event: 'generate_lead', event_id: 'lead-1' }]);
});

test('a Google Ads conversion fires only where a label exists', () => {
  const labels = { conversionId: '123456', purchaseLabel: 'AbCd', leadLabel: undefined };
  assert.deepEqual(googleAdsConversion(purchase, labels), {
    send_to: 'AW-123456/AbCd',
    value: 8260,
    currency: 'INR',
    transaction_id: 'ORD-2026-00003',
  });
  assert.equal(googleAdsConversion({ name: 'generate_lead', eventId: 'x' }, labels), null);
  assert.equal(googleAdsConversion(purchase, { conversionId: 'AW-9', purchaseLabel: 'L' })?.send_to, 'AW-9/L');
});
