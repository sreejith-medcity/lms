/**
 * The pages that must answer after a deploy.
 *
 * Written because a screen shipped that threw a server error for every user
 * and nobody noticed until it was opened by hand, hours later. A typecheck
 * cannot catch that, a unit test cannot catch that, and the runtime log only
 * says so once somebody has already hit it.
 *
 * The important design decision is the `as` field. That failure was a
 * permission check throwing for a signed-in administrator; an anonymous
 * request would have been redirected to the login page and reported a cheerful
 * pass. So the admin surface is checked while carrying a session, and a run
 * without one says it skipped those rather than pretending they were fine.
 */

export type Audience = 'anyone' | 'staff';

export interface Check {
  path: string;
  /** Status codes that mean this page is doing its job. */
  expect: number[];
  as: Audience;
  /** Why this one is on the list, so nobody deletes it to make a run green. */
  why: string;
}

const OK = [200];
/** Next issues 307 and 308 where an older stack would say 302 and 301. */
const REDIRECT = [301, 302, 307, 308];

export const CHECKS: Check[] = [
  { path: '/', expect: OK, as: 'anyone', why: 'The front door, and the page every ad and every search result points at.' },
  { path: '/courses', expect: OK, as: 'anyone', why: 'The catalogue, and the page most search traffic lands on.' },
  { path: '/about', expect: OK, as: 'anyone', why: 'Linked from every page footer.' },
  { path: '/contact', expect: OK, as: 'anyone', why: 'Where an enquiry is written, so a 500 here is lost admissions.' },
  { path: '/login', expect: OK, as: 'anyone', why: 'No sign-in, no product.' },
  { path: '/login/code', expect: OK, as: 'anyone', why: 'The door most learners here will use.' },
  { path: '/signup', expect: OK, as: 'anyone', why: 'The other half of no sign-in, no product.' },
  { path: '/sitemap.xml', expect: OK, as: 'anyone', why: 'Search engines read it; a 500 is invisible for weeks.' },
  { path: '/robots.txt', expect: OK, as: 'anyone', why: 'Same: a broken robots.txt is invisible until rankings move.' },
  {
    path: '/this-path-does-not-exist-smoke-check',
    expect: [404],
    as: 'anyone',
    why: 'A genuine 404 must stay a 404. The redirect catch-all runs here, and a bug in it would swallow every unknown path.',
  },

  // Everything below needs a session. These are the ones that shipped broken.
  { path: '/admin', expect: OK, as: 'staff', why: 'The dashboard, and the first thing any member of staff opens.' },
  { path: '/admin/courses', expect: OK, as: 'staff', why: 'Where the catalogue is edited, so nothing gets published without it.' },
  { path: '/admin/learners', expect: OK, as: 'staff', why: 'The learner list, which the counsellors work from.' },
  { path: '/admin/sessions', expect: OK, as: 'staff', why: 'Classes, which trainers open every day of the week.' },
  { path: '/admin/payments', expect: OK, as: 'staff', why: 'Money in, so a failure here is invisible revenue.' },
  { path: '/admin/settings', expect: OK, as: 'staff', why: 'The settings index, and the way into every screen below it.' },
  {
    path: '/admin/settings/redirects',
    expect: OK,
    as: 'staff',
    why: 'This is the one that shipped throwing FORBIDDEN for everybody. It is on the list by name.',
  },
  { path: '/admin/settings/integrations', expect: OK, as: 'staff', why: 'Every credential in the product.' },
  { path: '/admin/settings/messaging', expect: OK, as: 'staff', why: 'Whether anything is sending.' },
  { path: '/admin/settings/migration', expect: OK, as: 'staff', why: 'The WooCommerce migration console, needed on cutover day of all days.' },
  { path: '/admin/reports', expect: OK, as: 'staff', why: 'Thirty-one reports behind one page.' },
  { path: '/learn', expect: [...OK, ...REDIRECT], as: 'staff', why: 'The learner home. Staff may be redirected, which is fine; a 500 is not.' },
];

export interface Result {
  path: string;
  as: Audience;
  status: number | null;
  ok: boolean;
  skipped: boolean;
  detail: string;
  ms: number;
}

export interface SmokeOptions {
  /** The value of the session cookie, for the checks that need one. */
  sessionCookie?: string | null;
  timeoutMs?: number;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
}

export interface SmokeReport {
  base: string;
  results: Result[];
  passed: number;
  failed: number;
  skipped: number;
}

export async function runSmoke(base: string, options: SmokeOptions = {}): Promise<SmokeReport> {
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const root = base.replace(/\/$/, '');

  const results: Result[] = [];

  for (const check of CHECKS) {
    if (check.as === 'staff' && !options.sessionCookie) {
      results.push({
        path: check.path,
        as: check.as,
        status: null,
        ok: true,
        skipped: true,
        detail: 'No session supplied, so this was not checked.',
        ms: 0,
      });
      continue;
    }

    const started = Date.now();
    let status: number | null = null;
    let detail = '';

    try {
      const response = await doFetch(`${root}${check.path}`, {
        // Redirects are not followed: a page that answers 307 to the login
        // form is a different fact from one that answers 200, and following
        // the hop would hide it.
        redirect: 'manual',
        headers: {
          ...(check.as === 'staff' && options.sessionCookie
            ? { cookie: `mlms_session=${options.sessionCookie}` }
            : {}),
          'user-agent': 'medcity-lms-smoke',
          'cache-control': 'no-cache',
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      status = response.status;
      if (!check.expect.includes(status)) {
        detail = `expected ${check.expect.join(' or ')}, got ${status}`;
      }
    } catch (err) {
      detail = err instanceof Error ? err.message : String(err);
    }

    results.push({
      path: check.path,
      as: check.as,
      status,
      ok: status !== null && check.expect.includes(status),
      skipped: false,
      detail,
      ms: Date.now() - started,
    });
  }

  return {
    base: root,
    results,
    passed: results.filter((r) => r.ok && !r.skipped).length,
    failed: results.filter((r) => !r.ok).length,
    skipped: results.filter((r) => r.skipped).length,
  };
}

/** One line per check, and the reason attached to anything that failed. */
export function formatReport(report: SmokeReport): string {
  const lines = [`Smoke test against ${report.base}`, ''];

  for (const result of report.results) {
    const mark = result.skipped ? '-' : result.ok ? 'ok' : 'FAIL';
    const status = result.skipped ? 'skipped' : (result.status ?? 'no answer');
    lines.push(`  ${mark.padEnd(4)} ${String(status).padEnd(9)} ${result.path}`);
    if (!result.ok) {
      const why = CHECKS.find((c) => c.path === result.path)?.why ?? '';
      lines.push(`       ${result.detail}`);
      if (why) lines.push(`       ${why}`);
    }
  }

  lines.push('');
  lines.push(
    `${report.passed} passed, ${report.failed} failed${report.skipped ? `, ${report.skipped} skipped` : ''}.`,
  );

  // Every single request failing to connect is almost never a broken site. It
  // is a machine that cannot reach the host: a proxy, a VPN, a firewall, or a
  // typo in the URL. Saying "10 failed" and leaving it there sends somebody to
  // read deployment logs for a problem that is on their own desk.
  if (report.failed > 0 && report.passed === 0 && report.results.every((r) => r.skipped || r.status === null)) {
    lines.push('');
    lines.push(
      'Nothing answered at all, which usually means this machine cannot reach that host rather than that the site is down.',
    );
    lines.push('Check the URL, and try it in a browser from here before reading any deployment logs.');
  }

  if (report.skipped > 0) {
    lines.push(
      'The skipped ones need a session. Sign in, copy the mlms_session cookie, and set SMOKE_SESSION to it.',
    );
    lines.push(
      'They are the ones worth checking: the last screen to ship broken failed only for signed-in staff.',
    );
  }

  return lines.join('\n');
}
