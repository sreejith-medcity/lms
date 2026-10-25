/**
 * Teknolyv (formerly Medcity Meet) moved from meet.medcitylms.in to
 * teknolyv.com. No server imports here, so pages, mail and calendar code can
 * use it too.
 */

/** Where Teknolyv lives now. Its API is under /api/v1 and join links under /j/. */
export const TEKNOLYV_ORIGIN = 'https://teknolyv.com';
export const TEKNOLYV_API_URL = `${TEKNOLYV_ORIGIN}/api/v1`;

/** Hosts Teknolyv used to answer on. Anything pointing there is moved to TEKNOLYV_ORIGIN. */
const OLD_TEKNOLYV_HOSTS = new Set(['meet.medcitylms.in', 'www.meet.medcitylms.in']);

/**
 * Moves a URL on the old Medcity Meet host to teknolyv.com, keeping its path
 * and query. Used on a stored API URL, on links Teknolyv hands back, and on
 * join and host links read back from stored classes, so tenants and rows that
 * still say meet.medcitylms.in follow along without a data migration. Any other
 * URL (Zoom, a relative /live/... path) comes back as it was.
 */
export function teknolyvUrl(url: string): string;
export function teknolyvUrl(url: string | null): string | null;
export function teknolyvUrl(url: string | null | undefined): string | null | undefined;
export function teknolyvUrl(url: string | null | undefined): string | null | undefined {
  if (!url) return url;
  try {
    const u = new URL(url.trim());
    if (!OLD_TEKNOLYV_HOSTS.has(u.hostname.toLowerCase())) return url;
    const target = new URL(TEKNOLYV_ORIGIN);
    u.protocol = target.protocol;
    u.host = target.host;
    return u.toString();
  } catch {
    return url;
  }
}
