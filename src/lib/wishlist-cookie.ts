/**
 * The wishlist, readable by the browser.
 *
 * Course pages and the catalogue are held by a CDN, so whether a heart is
 * filled cannot be decided on the server. A cookie carries the saved
 * product ids; the button reads it, the server action writes it (and the
 * database, for a signed-in learner). It grants nothing: forging it changes
 * which hearts are red.
 *
 * No imports on purpose: this is pulled into client components.
 */

export const WISH_COOKIE = 'mlms_wish';
export const WISH_EVENT = 'mlms:wish';
export const WISH_MAX = 60;

export function parseWishCookie(value: string | null | undefined): string[] {
  if (!value) return [];
  return Array.from(new Set(value.split(',').map((s) => s.trim()).filter((s) => /^[A-Za-z0-9_-]{1,40}$/.test(s)))).slice(0, WISH_MAX);
}

export function serialiseWishCookie(ids: string[]): string {
  return Array.from(new Set(ids)).slice(0, WISH_MAX).join(',');
}

export function readWishFromDocument(cookieString: string): string[] {
  const match = cookieString.split('; ').find((c) => c.startsWith(`${WISH_COOKIE}=`));
  return parseWishCookie(match ? decodeURIComponent(match.slice(WISH_COOKIE.length + 1)) : null);
}

export function toggleId(ids: string[], id: string): { ids: string[]; saved: boolean } {
  if (ids.includes(id)) return { ids: ids.filter((x) => x !== id), saved: false };
  return { ids: [...ids, id].slice(-WISH_MAX), saved: true };
}
