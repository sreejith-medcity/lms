import { cache } from 'react';
import { resolveIntegration } from '@/lib/integration-store';
import type { GoogleAdsLabels } from '@/lib/tracking-events';

/**
 * Which tags this academy has asked for, in the shape the page needs.
 *
 * Only public identifiers leave here: a measurement ID, a pixel ID, a
 * container ID. They are printed into every page anyway, so there is
 * nothing to protect; the API secrets on the same cards never come near.
 *
 * One rule decides double counting: a Tag Manager container takes over. If
 * one is set, GA4 and the Meta pixel are not loaded directly, the events go
 * to the dataLayer, and the container is expected to hold those tags.
 */
export interface TrackingTags {
  gtm?: string;
  ga4?: string;
  metaPixel?: string;
  googleAds?: GoogleAdsLabels;
  clarity?: string;
}

export const trackingTags = cache(async (organizationId: string): Promise<TrackingTags> => {
  const [gtm, ga4, pixel, capi, ads, clarity] = await Promise.all([
    resolveIntegration(organizationId, 'gtm'),
    resolveIntegration(organizationId, 'ga4'),
    resolveIntegration(organizationId, 'meta_pixel'),
    resolveIntegration(organizationId, 'meta_capi'),
    resolveIntegration(organizationId, 'google_ads'),
    resolveIntegration(organizationId, 'clarity'),
  ]);

  const tags: TrackingTags = {};

  const container = gtm?.values.containerId?.trim();
  if (container && /^GTM-[A-Z0-9]+$/i.test(container)) tags.gtm = container.toUpperCase();

  const measurement = ga4?.values.measurementId?.trim();
  if (measurement && /^G-[A-Z0-9]+$/i.test(measurement)) tags.ga4 = measurement.toUpperCase();

  // The pixel card or the Conversions API card: either names the pixel.
  const pixelId = (pixel?.values.pixelId ?? capi?.values.pixelId ?? '').trim();
  if (/^\d{6,20}$/.test(pixelId)) tags.metaPixel = pixelId;

  const conversionId = ads?.values.conversionId?.trim();
  if (conversionId && /^(AW-)?\d{6,15}$/i.test(conversionId)) {
    tags.googleAds = {
      conversionId: conversionId.toUpperCase().replace(/^AW-/, 'AW-'),
      purchaseLabel: ads?.values.conversionLabel?.trim() || undefined,
      leadLabel: ads?.values.leadLabel?.trim() || undefined,
      signUpLabel: ads?.values.signUpLabel?.trim() || undefined,
    };
  }

  const project = clarity?.values.projectId?.trim();
  if (project && /^[a-z0-9]{6,20}$/i.test(project)) tags.clarity = project;

  return tags;
});
