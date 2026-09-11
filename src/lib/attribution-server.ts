import { cookies, headers } from 'next/headers';
import type { Prisma } from '@prisma/client';
import {
  ATTRIBUTION_COOKIE,
  attributionForOrder,
  fbcFrom,
  type OrderAttribution,
} from '@/lib/attribution';

/**
 * The request's attribution, read once at the moment an order or a lead is
 * created. Stored as JSON on the row; the conversion reporter reads it back
 * from there, hours later when the webhook lands, when the request that
 * carried the cookie is long gone.
 */
export async function requestAttribution(): Promise<OrderAttribution | null> {
  const [jar, h] = await Promise.all([cookies(), headers()]);
  return attributionForOrder({
    attributionCookie: jar.get(ATTRIBUTION_COOKIE)?.value ?? null,
    cookieHeader: h.get('cookie'),
    userAgent: h.get('user-agent'),
  });
}

export function attributionJson(a: OrderAttribution | null): Prisma.InputJsonValue | undefined {
  return a ? (a as unknown as Prisma.InputJsonValue) : undefined;
}

/** What `reportConversion` wants, from what the row stored. */
export function conversionHints(raw: unknown): {
  clickIds: { gclid?: string | null; fbclid?: string | null; fbp?: string | null; fbc?: string | null };
  clientId: string | null;
  userAgent: string | null;
} {
  const a = (raw ?? null) as OrderAttribution | null;
  if (!a || typeof a !== 'object') return { clickIds: {}, clientId: null, userAgent: null };
  const last = a.last ?? {};
  const first = a.first ?? {};
  const fbclid = last.fbclid ?? first.fbclid ?? null;
  return {
    clickIds: {
      gclid: last.gclid ?? first.gclid ?? null,
      fbclid,
      fbp: a.fbp ?? null,
      fbc: fbclid ? (fbcFrom(fbclid, new Date(last.fbclid ? last.at : first.at)) ?? null) : null,
    },
    clientId: a.gaClientId ?? null,
    userAgent: a.userAgent ?? null,
  };
}
