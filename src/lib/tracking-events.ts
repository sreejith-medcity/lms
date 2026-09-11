/**
 * One event, three dialects.
 *
 * The storefront raises one event ("somebody bought this") and every tag on
 * the page hears it in its own vocabulary: GA4's ecommerce shape, Meta's
 * standard events, a dataLayer push for Tag Manager, and a Google Ads
 * conversion where a label is configured. Written once here, so the four
 * never drift apart and a purchase is a purchase everywhere.
 *
 * Every event carries our own id. The server sends the same id for the
 * same purchase, and that is how the platforms count one sale, not two.
 */

export interface TrackItem {
  id: string;
  name: string;
  pricePaise: number;
  category?: string;
  quantity?: number;
}

export type TrackEvent =
  | { name: 'view_item'; items: TrackItem[]; currency: string }
  | { name: 'add_to_cart'; items: TrackItem[]; currency: string }
  | { name: 'begin_checkout'; items: TrackItem[]; currency: string; valuePaise: number; eventId: string }
  | {
      name: 'purchase';
      items: TrackItem[];
      currency: string;
      valuePaise: number;
      taxPaise: number;
      transactionId: string;
      eventId: string;
    }
  | { name: 'generate_lead'; eventId: string; currency?: string; valuePaise?: number }
  | { name: 'sign_up'; eventId: string; method?: string };

const rupees = (paise: number) => Math.round(paise) / 100;

function ga4Items(items: TrackItem[]) {
  return items.map((i) => ({
    item_id: i.id,
    item_name: i.name,
    price: rupees(i.pricePaise),
    quantity: i.quantity ?? 1,
    ...(i.category ? { item_category: i.category } : {}),
  }));
}

function sum(items: TrackItem[]) {
  return items.reduce((n, i) => n + i.pricePaise * (i.quantity ?? 1), 0);
}

/** gtag('event', name, params). */
export function ga4Payload(e: TrackEvent): { name: string; params: Record<string, unknown> } {
  switch (e.name) {
    case 'view_item':
    case 'add_to_cart':
      return {
        name: e.name,
        params: { currency: e.currency, value: rupees(sum(e.items)), items: ga4Items(e.items) },
      };
    case 'begin_checkout':
      return {
        name: 'begin_checkout',
        params: { currency: e.currency, value: rupees(e.valuePaise), items: ga4Items(e.items) },
      };
    case 'purchase':
      return {
        name: 'purchase',
        params: {
          transaction_id: e.transactionId,
          currency: e.currency,
          value: rupees(e.valuePaise),
          tax: rupees(e.taxPaise),
          items: ga4Items(e.items),
        },
      };
    case 'generate_lead':
      return {
        name: 'generate_lead',
        params: {
          ...(e.currency ? { currency: e.currency } : {}),
          ...(e.valuePaise !== undefined ? { value: rupees(e.valuePaise) } : {}),
        },
      };
    case 'sign_up':
      return { name: 'sign_up', params: { ...(e.method ? { method: e.method } : {}) } };
  }
}

/** fbq('track', name, params, { eventID }). */
export function metaPayload(e: TrackEvent): {
  name: string;
  params: Record<string, unknown>;
  eventId?: string;
} {
  const contents = (items: TrackItem[]) => ({
    content_type: 'product',
    content_ids: items.map((i) => i.id),
    contents: items.map((i) => ({ id: i.id, quantity: i.quantity ?? 1, item_price: rupees(i.pricePaise) })),
  });
  switch (e.name) {
    case 'view_item':
      return {
        name: 'ViewContent',
        params: { ...contents(e.items), content_name: e.items[0]?.name, currency: e.currency, value: rupees(sum(e.items)) },
      };
    case 'add_to_cart':
      return {
        name: 'AddToCart',
        params: { ...contents(e.items), content_name: e.items[0]?.name, currency: e.currency, value: rupees(sum(e.items)) },
      };
    case 'begin_checkout':
      return {
        name: 'InitiateCheckout',
        params: { ...contents(e.items), currency: e.currency, value: rupees(e.valuePaise), num_items: e.items.length },
        eventId: e.eventId,
      };
    case 'purchase':
      return {
        name: 'Purchase',
        params: { ...contents(e.items), currency: e.currency, value: rupees(e.valuePaise), order_id: e.transactionId },
        eventId: e.eventId,
      };
    case 'generate_lead':
      return {
        name: 'Lead',
        params: {
          ...(e.currency ? { currency: e.currency } : {}),
          ...(e.valuePaise !== undefined ? { value: rupees(e.valuePaise) } : {}),
        },
        eventId: e.eventId,
      };
    case 'sign_up':
      return { name: 'CompleteRegistration', params: {}, eventId: e.eventId };
  }
}

/**
 * window.dataLayer.push(...). GA4's recommended shape, so a Tag Manager
 * container with the standard GA4 ecommerce tag works with no mapping.
 * The previous ecommerce object is cleared first, as Google advises.
 */
export function dataLayerPayloads(e: TrackEvent): Record<string, unknown>[] {
  const ga = ga4Payload(e);
  const { items, ...rest } = ga.params as { items?: unknown[] } & Record<string, unknown>;
  const eventId = 'eventId' in e ? e.eventId : undefined;
  const body: Record<string, unknown> = {
    event: ga.name,
    ...(eventId ? { event_id: eventId } : {}),
  };
  if (items) body.ecommerce = { ...rest, items };
  else Object.assign(body, rest);
  return items ? [{ ecommerce: null }, body] : [body];
}

export interface GoogleAdsLabels {
  conversionId: string;
  purchaseLabel?: string;
  leadLabel?: string;
  signUpLabel?: string;
}

/** gtag('event', 'conversion', params), or null when no label is set for it. */
export function googleAdsConversion(
  e: TrackEvent,
  labels: GoogleAdsLabels,
): Record<string, unknown> | null {
  const id = labels.conversionId.startsWith('AW-') ? labels.conversionId : `AW-${labels.conversionId}`;
  const label =
    e.name === 'purchase'
      ? labels.purchaseLabel
      : e.name === 'generate_lead'
        ? labels.leadLabel
        : e.name === 'sign_up'
          ? labels.signUpLabel
          : undefined;
  if (!label) return null;

  return {
    send_to: `${id}/${label}`,
    ...(e.name === 'purchase'
      ? { value: rupees(e.valuePaise), currency: e.currency, transaction_id: e.transactionId }
      : {}),
    ...(e.name === 'generate_lead' && e.valuePaise !== undefined
      ? { value: rupees(e.valuePaise), currency: e.currency ?? 'INR' }
      : {}),
  };
}
