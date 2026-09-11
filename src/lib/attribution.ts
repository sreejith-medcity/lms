/**
 * Where a visitor came from, remembered until they buy.
 *
 * An ad click lands with a click id and UTM parameters in the address bar,
 * and by the time the same person pays, three visits and a week later, none
 * of that is anywhere unless somebody kept it. This keeps it: first touch,
 * which never changes, and last touch, which the latest tagged visit
 * overwrites. Both go onto the order, and from there to the ad platforms,
 * which is what turns "we spent forty thousand" into "each enrolment cost
 * this much".
 *
 * Pure, so the browser can run it against the address bar and a cookie,
 * and the server can read the cookie back with the same code.
 */

export interface Touch {
  /** Google Ads click id. */
  gclid?: string;
  /** Meta click id, from the fbclid parameter. */
  fbclid?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  /** The page they landed on, path and query. */
  landing?: string;
  /** The site that sent them, hostname only. */
  referrer?: string;
  /** ISO time. */
  at: string;
}

export interface Attribution {
  first: Touch;
  last: Touch;
}

export const ATTRIBUTION_COOKIE = 'mlms_attr';
export const ATTRIBUTION_DAYS = 90;

const CLICK_KEYS = ['gclid', 'fbclid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const;

const MAX = 200;

function clean(value: string | null): string | undefined {
  const v = (value ?? '').trim();
  return v ? v.slice(0, MAX) : undefined;
}

/** The parameters worth keeping from an address, or null if it carries none. */
export function touchFromUrl(url: URL, referrer: string | null, now: Date): Touch | null {
  const touch: Touch = { at: now.toISOString() };
  let tagged = false;
  for (const key of CLICK_KEYS) {
    const v = clean(url.searchParams.get(key));
    if (v) {
      touch[key] = v;
      tagged = true;
    }
  }

  const from = referrerHost(referrer, url.hostname);
  if (!tagged && !from) return null;

  touch.landing = `${url.pathname}${url.search}`.slice(0, 500);
  if (from) touch.referrer = from;
  return touch;
}

/** The referring site, unless it is us. */
export function referrerHost(referrer: string | null, ownHost: string): string | undefined {
  if (!referrer) return undefined;
  try {
    const host = new URL(referrer).hostname.toLowerCase();
    if (!host || host === ownHost.toLowerCase()) return undefined;
    return host;
  } catch {
    return undefined;
  }
}

export function parseAttribution(raw: string | null | undefined): Attribution | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Attribution>;
    if (!parsed || typeof parsed !== 'object' || !parsed.first || !parsed.last) return null;
    return { first: parsed.first, last: parsed.last };
  } catch {
    try {
      return parseAttribution(decodeURIComponent(raw));
    } catch {
      return null;
    }
  }
}

/**
 * What the cookie should hold after this page view. Null means leave it
 * alone: an untagged visit from nowhere in particular changes nothing.
 */
export function captureAttribution(
  url: URL,
  referrer: string | null,
  existing: string | null | undefined,
  now: Date,
): Attribution | null {
  const touch = touchFromUrl(url, referrer, now);
  if (!touch) return null;

  const current = parseAttribution(existing);
  // A plain referral does not overwrite a paid click as the last touch:
  // "came back via Google search after clicking the ad" is still the ad.
  const paid = Boolean(touch.gclid || touch.fbclid || touch.utm_source);
  const lastWasPaid = Boolean(current?.last.gclid || current?.last.fbclid || current?.last.utm_source);
  if (current && !paid && lastWasPaid) return null;

  return { first: current?.first ?? touch, last: touch };
}

export function serialiseAttribution(a: Attribution): string {
  return JSON.stringify(a);
}

/** The Meta browser id, from the _fbp cookie the pixel sets. */
export function fbpFrom(cookieHeader: string | null | undefined): string | undefined {
  const m = /(?:^|;\s*)_fbp=([^;]+)/.exec(cookieHeader ?? '');
  return m ? decodeURIComponent(m[1]).slice(0, 100) : undefined;
}

/** The GA4 client id, from the _ga cookie: GA1.1.123.456 becomes 123.456. */
export function gaClientIdFrom(cookieHeader: string | null | undefined): string | undefined {
  const m = /(?:^|;\s*)_ga=([^;]+)/.exec(cookieHeader ?? '');
  if (!m) return undefined;
  const parts = decodeURIComponent(m[1]).split('.');
  return parts.length >= 4 ? `${parts[2]}.${parts[3]}` : undefined;
}

/** Meta's fbc value, built from the click id the way their docs ask. */
export function fbcFrom(fbclid: string | undefined, at: Date): string | undefined {
  return fbclid ? `fb.1.${at.getTime()}.${fbclid}` : undefined;
}

/**
 * Everything the order should carry, from the cookies of the request that
 * created it. The shape is what the conversion reporter reads.
 */
export interface OrderAttribution extends Attribution {
  fbp?: string;
  gaClientId?: string;
  userAgent?: string;
}

export function attributionForOrder(input: {
  attributionCookie: string | null | undefined;
  cookieHeader: string | null | undefined;
  userAgent?: string | null;
}): OrderAttribution | null {
  const base = parseAttribution(input.attributionCookie);
  const fbp = fbpFrom(input.cookieHeader);
  const gaClientId = gaClientIdFrom(input.cookieHeader);
  if (!base && !fbp && !gaClientId) return null;
  const now = new Date().toISOString();
  return {
    first: base?.first ?? { at: now },
    last: base?.last ?? { at: now },
    ...(fbp ? { fbp } : {}),
    ...(gaClientId ? { gaClientId } : {}),
    ...(input.userAgent ? { userAgent: input.userAgent.slice(0, 300) } : {}),
  };
}

/** The stored JSON column, as an Attribution or null. */
export function parseAttributionValue(raw: unknown): Attribution | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Partial<Attribution>;
  return a.first && a.last ? { first: a.first, last: a.last } : null;
}

/** A one-line description for a screen: "Google Ads · nclex-kochi" or "Direct". */
export function describeAttribution(a: Attribution | null | undefined): string {
  if (!a) return 'Direct';
  const t = a.last;
  if (t.gclid) return `Google Ads${t.utm_campaign ? ` · ${t.utm_campaign}` : ''}`;
  if (t.fbclid) return `Meta Ads${t.utm_campaign ? ` · ${t.utm_campaign}` : ''}`;
  if (t.utm_source) return [t.utm_source, t.utm_medium, t.utm_campaign].filter(Boolean).join(' · ');
  if (t.referrer) return t.referrer;
  return 'Direct';
}
