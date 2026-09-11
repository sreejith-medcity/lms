import type { TrackingTags } from '@/lib/tracking-config';
import {
  dataLayerPayloads,
  ga4Payload,
  googleAdsConversion,
  metaPayload,
  type TrackEvent,
} from '@/lib/tracking-events';

/**
 * The one function the storefront calls when something happens.
 *
 * It fans out to whichever tags the page carries. With a Tag Manager
 * container the event goes to the dataLayer and nowhere else, and the
 * container is expected to hold the GA4, Meta and Google Ads tags; without
 * one, the direct tags are called. Never both, which is what stops a single
 * purchase being counted twice on the same platform.
 */

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    fbq?: (...args: unknown[]) => void;
    __mlmsTags?: TrackingTags;
  }
}

export function track(e: TrackEvent): void {
  if (typeof window === 'undefined') return;
  const tags = window.__mlmsTags ?? {};

  try {
    if (tags.gtm) {
      window.dataLayer = window.dataLayer ?? [];
      for (const payload of dataLayerPayloads(e)) window.dataLayer.push(payload);
      return;
    }

    if (tags.ga4 && window.gtag) {
      const g = ga4Payload(e);
      window.gtag('event', g.name, g.params);
    }
    if (tags.metaPixel && window.fbq) {
      const m = metaPayload(e);
      window.fbq('track', m.name, m.params, m.eventId ? { eventID: m.eventId } : undefined);
    }
    if (tags.googleAds && window.gtag) {
      const c = googleAdsConversion(e, tags.googleAds);
      if (c) window.gtag('event', 'conversion', c);
    }
  } catch (err) {
    // A tag throwing must never break the page it is on.
    console.warn('[track]', err);
  }
}

/**
 * Once per browser for a given key. A thank-you page refreshed three times
 * is one purchase; the platforms deduplicate on the id too, but there is no
 * reason to make them.
 */
export function trackOnce(key: string, e: TrackEvent): void {
  if (typeof window === 'undefined') return;
  const storageKey = `mlms_tracked:${key}`;
  try {
    if (window.sessionStorage.getItem(storageKey)) return;
    window.sessionStorage.setItem(storageKey, '1');
  } catch {
    /* storage blocked: send it anyway, dedup is the platforms' job too */
  }
  track(e);
}
