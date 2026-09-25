/**
 * The separate telc site's addresses, once its name points here.
 *
 * When telc.medcitylms.in is retired, its DNS is pointed at the VPS and its
 * name listed in TESTS_LEGACY_HOSTS; every request for it is then sent, for
 * good (308), to the same page in the portal on TESTS_LEGACY_TARGET (the
 * academy's own address). The level pages keep their slugs, so what search
 * engines hold carries straight over. Pure, so the middleware can use it
 * and a test can pin it.
 */

const LEVEL = /^\/(a1|a2|b1|b2)(?:-telc-mocktest)?\/?$/i;

export function legacyTestPath(pathname: string): string {
  const level = LEVEL.exec(pathname);
  if (level) return `/tests/${level[1].toLowerCase()}-telc-mocktest`;
  if (/^\/dashboard(\/|$)/.test(pathname)) return '/learn/tests';
  if (/^\/(sign-in|login)\/?$/.test(pathname)) return '/login';
  return '/tests';
}

export function legacyHosts(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

/** The whole Location for a legacy request, or null when this host is not one or no target is set. */
export function legacyRedirect(hostname: string, pathname: string, env: { hosts?: string; target?: string }): string | null {
  if (!legacyHosts(env.hosts).includes(hostname.toLowerCase())) return null;
  const target = (env.target ?? '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(target)) return null;
  return `${target}${legacyTestPath(pathname)}`;
}
