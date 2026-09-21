import { headers } from 'next/headers';

/**
 * Whether this request comes from inside the phone app's web view.
 *
 * The app appends this token to the web view's user agent. A page shown
 * inside the app already sits under the app's own bar, so the shells
 * (sidebar, header, sign-out) are left out and the page stands alone;
 * nothing else changes, so the page is the same page a browser gets.
 */
export const APP_UA_TOKEN = 'MedcityLMSApp';

export async function inApp(): Promise<boolean> {
  const ua = (await headers()).get('user-agent') ?? '';
  return ua.includes(APP_UA_TOKEN);
}
