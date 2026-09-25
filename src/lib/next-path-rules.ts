/** Where to go after the door: only a path on this site, never another host. Pure, so the middleware can use it. */
export const NEXT_COOKIE = 'lms_next';

export function safeNextPath(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  if (!v.startsWith('/') || v.startsWith('//') || v.startsWith('/\\') || v.length > 300) return null;
  if (/[\r\n]/.test(v)) return null;
  return v;
}
