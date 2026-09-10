/**
 * The basket count, readable by the browser.
 *
 * Same trick as the "who is signed in" cookie beside it, and for the same
 * reason: the header shows a number on pages a CDN holds, so the number cannot
 * be rendered on the server. It carries no secret and grants nothing. Forging
 * it changes a badge and nothing else, because the cart itself is read from
 * the database on the cart page.
 *
 * This file has no imports on purpose. It is pulled into client components,
 * and the module that writes the cookie reaches for node:crypto and Prisma.
 */

export const CART_COOKIE = 'mlms_cart';
export const CART_COUNT_COOKIE = 'mlms_cart_n';

/** Fired after the basket changes, so every badge on the page catches up. */
export const CART_EVENT = 'mlms:cart';

export function readCartCountFromDocument(cookieString: string): number {
  for (const part of cookieString.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name !== CART_COUNT_COOKIE) continue;
    const value = Number(decodeURIComponent(rest.join('=')));
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
  }
  return 0;
}
