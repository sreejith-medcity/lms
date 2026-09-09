import { createHash } from 'node:crypto';
import { resolveIntegration } from '@/lib/integration-store';
import { recordIntegrationEvent } from '@/lib/integration-events';

/**
 * Telling the ad platforms what actually happened.
 *
 * The browser tag reports a purchase when the confirmation page loads. Between
 * a third and a half of those never arrive: ad blockers, iOS, a learner closing
 * the tab while the payment redirects. So the same event is also sent from here,
 * where nothing can block it, keyed so the platforms can deduplicate against the
 * browser's copy rather than counting it twice.
 *
 * This is the difference between a cost per enrolment that looks terrible and
 * one that is true.
 */

export interface Conversion {
  organizationId: string;
  event: 'purchase' | 'lead' | 'sign_up';
  /** Our own id for the thing, used by every platform to deduplicate. */
  eventId: string;
  valuePaise?: number;
  currency?: string;
  email?: string | null;
  phone?: string | null;
  /** The click ids the landing page captured, without which none of this works. */
  clickIds?: { gclid?: string | null; fbclid?: string | null; fbp?: string | null };
  clientId?: string | null;
  userAgent?: string | null;
  ip?: string | null;
}

/** Meta and Google both want contact details hashed, lowercased and trimmed. */
function hashed(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  return createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

function digitsOnly(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const digits = value.replace(/\D/g, '');
  if (!digits) return undefined;
  return createHash('sha256')
    .update(digits.length === 10 ? `91${digits}` : digits)
    .digest('hex');
}

export async function reportConversion(conversion: Conversion): Promise<void> {
  // Deliberately not awaited as a group with a shared failure: one platform
  // being down must not stop the others, and none of them may stop an
  // enrolment. Every one of these swallows its own error.
  await Promise.allSettled([
    toGa4(conversion),
    toMetaCapi(conversion),
  ]);
}

async function toGa4(conversion: Conversion): Promise<void> {
  const resolved = await resolveIntegration(conversion.organizationId, 'ga4');
  if (!resolved?.complete) return;

  const { measurementId, apiSecret } = resolved.values;
  if (!apiSecret) return;

  // GA4 needs a client id to attribute the event to the same person the browser
  // saw. Without one it still records, but as a new visitor, which is worth
  // saying out loud rather than pretending the number is joined up.
  const clientId = conversion.clientId ?? `${Date.now()}.${Math.floor(Math.random() * 1e9)}`;

  try {
    const response = await fetch(
      `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`,
      {
        method: 'POST',
        body: JSON.stringify({
          client_id: clientId,
          events: [
            {
              name: conversion.event,
              params: {
                transaction_id: conversion.eventId,
                currency: conversion.currency ?? 'INR',
                value: (conversion.valuePaise ?? 0) / 100,
                engagement_time_msec: 1,
              },
            },
          ],
        }),
        signal: AbortSignal.timeout(5000),
      },
    );

    await recordIntegrationEvent({
      organizationId: conversion.organizationId,
      provider: 'ga4',
      direction: 'OUT',
      action: `${conversion.event} reported`,
      ok: response.ok,
      records: 1,
      detail: response.ok ? null : `GA4 answered ${response.status}.`,
    });
  } catch (err) {
    await recordIntegrationEvent({
      organizationId: conversion.organizationId,
      provider: 'ga4',
      direction: 'OUT',
      action: `${conversion.event} reported`,
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

async function toMetaCapi(conversion: Conversion): Promise<void> {
  const resolved = await resolveIntegration(conversion.organizationId, 'meta_capi');
  if (!resolved?.complete) return;

  const { pixelId, accessToken, testEventCode } = resolved.values;

  const NAMES: Record<Conversion['event'], string> = {
    purchase: 'Purchase',
    lead: 'Lead',
    sign_up: 'CompleteRegistration',
  };

  try {
    const response = await fetch(`https://graph.facebook.com/v21.0/${pixelId}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        access_token: accessToken,
        ...(testEventCode ? { test_event_code: testEventCode } : {}),
        data: [
          {
            event_name: NAMES[conversion.event],
            event_time: Math.floor(Date.now() / 1000),
            // The same id the browser pixel sends, which is what lets Meta count
            // one conversion instead of two.
            event_id: conversion.eventId,
            action_source: 'website',
            user_data: {
              em: hashed(conversion.email),
              ph: digitsOnly(conversion.phone),
              fbc: conversion.clickIds?.fbclid
                ? `fb.1.${Math.floor(Date.now() / 1000)}.${conversion.clickIds.fbclid}`
                : undefined,
              fbp: conversion.clickIds?.fbp ?? undefined,
              client_user_agent: conversion.userAgent ?? undefined,
              client_ip_address: conversion.ip ?? undefined,
            },
            custom_data: {
              currency: conversion.currency ?? 'INR',
              value: (conversion.valuePaise ?? 0) / 100,
            },
          },
        ],
      }),
      signal: AbortSignal.timeout(5000),
    });

    await recordIntegrationEvent({
      organizationId: conversion.organizationId,
      provider: 'meta_capi',
      direction: 'OUT',
      action: `${NAMES[conversion.event]} reported`,
      ok: response.ok,
      records: 1,
      detail: response.ok ? null : (await response.text()).slice(0, 200),
    });
  } catch (err) {
    await recordIntegrationEvent({
      organizationId: conversion.organizationId,
      provider: 'meta_capi',
      direction: 'OUT',
      action: 'Conversion reported',
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}
