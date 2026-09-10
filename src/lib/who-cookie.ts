/**
 * A readable hint about who is signed in, so public pages can be cached.
 *
 * The session cookie is httpOnly and always will be. This one carries no
 * secret and grants nothing: it says "staff" or "learner" so the header can
 * show the right link in the browser, after the HTML has arrived.
 *
 * Why bother. Rendering that link on the server makes every public page
 * different for a signed-in visitor, which means no CDN can hold any of them,
 * which means the homepage and the catalogue hit the database on every view.
 * Moving one link into the browser is what buys edge caching for the whole
 * public site.
 *
 * Forging it gains nothing. It is read only to pick a label and a destination,
 * and both destinations are behind the real session check.
 */

export const WHO_COOKIE = 'mlms_who';

export type Who = 'staff' | 'learner';

export function isWho(value: string | undefined | null): value is Who {
  return value === 'staff' || value === 'learner';
}

/** Read it in the browser, where there is no cookie jar API worth the name. */
export function readWhoFromDocument(cookieString: string): Who | null {
  for (const part of cookieString.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name !== WHO_COOKIE) continue;
    const value = decodeURIComponent(rest.join('='));
    return isWho(value) ? value : null;
  }
  return null;
}
