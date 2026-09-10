import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { runSmoke, formatReport, CHECKS } from '../src/lib/smoke';

/**
 * The runner, against a real HTTP server rather than a mock.
 *
 * A smoke test that cannot itself be trusted is worse than none: it turns
 * green and everybody stops looking. So this stands up a server that answers
 * exactly what we tell it to, and checks the runner reports the truth.
 */

interface Started {
  base: string;
  stop: () => Promise<void>;
  seen: { path: string; cookie: string | undefined }[];
}

async function serve(handler: (path: string) => number): Promise<Started> {
  const seen: { path: string; cookie: string | undefined }[] = [];

  const server: Server = createServer((req, res) => {
    seen.push({ path: req.url ?? '', cookie: req.headers.cookie });
    res.writeHead(handler(req.url ?? ''), { 'content-type': 'text/plain' });
    res.end('.');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address === 'string' || address === null) throw new Error('no port');

  return {
    base: `http://127.0.0.1:${address.port}`,
    seen,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Whatever the real list says each path should answer. */
function expected(path: string): number {
  return CHECKS.find((c) => c.path === path)?.expect[0] ?? 200;
}

test('a healthy site passes every check', async () => {
  const site = await serve(expected);
  try {
    const report = await runSmoke(site.base, { sessionCookie: 'pretend-session' });
    assert.equal(report.failed, 0, formatReport(report));
    assert.equal(report.skipped, 0);
    assert.equal(report.passed, CHECKS.length);
  } finally {
    await site.stop();
  }
});

test('a page that throws is reported, with the reason it is on the list', async () => {
  // Exactly the failure that shipped: one admin screen, 500, everything else
  // fine. This is the case the whole file exists for.
  const site = await serve((path) =>
    path === '/admin/settings/redirects' ? 500 : expected(path),
  );
  try {
    const report = await runSmoke(site.base, { sessionCookie: 'pretend-session' });
    assert.equal(report.failed, 1);

    const failure = report.results.find((r) => !r.ok);
    assert.equal(failure?.path, '/admin/settings/redirects');
    assert.equal(failure?.status, 500);

    const text = formatReport(report);
    assert.match(text, /FAIL/);
    assert.match(text, /expected 200, got 500/);
    assert.match(text, /shipped throwing FORBIDDEN/);
  } finally {
    await site.stop();
  }
});

test('an admin page redirecting to login counts as a failure, not a pass', async () => {
  // The trap: an anonymous run sees 307 to the sign-in form and looks healthy
  // while the page behind it is broken. Carrying a session is what makes this
  // check mean anything.
  const site = await serve((path) => (path.startsWith('/admin') ? 307 : expected(path)));
  try {
    const report = await runSmoke(site.base, { sessionCookie: 'pretend-session' });
    assert.ok(report.failed > 0);
    assert.ok(report.results.filter((r) => !r.ok).every((r) => r.path.startsWith('/admin')));
  } finally {
    await site.stop();
  }
});

test('the session is sent only to the pages that need it', async () => {
  const site = await serve(expected);
  try {
    await runSmoke(site.base, { sessionCookie: 'abc123' });

    const withCookie = site.seen.filter((r) => r.cookie?.includes('abc123')).map((r) => r.path);
    const without = site.seen.filter((r) => !r.cookie).map((r) => r.path);

    assert.ok(withCookie.length > 0);
    assert.ok(withCookie.every((p) => CHECKS.find((c) => c.path === p)?.as === 'staff'));
    assert.ok(without.every((p) => CHECKS.find((c) => c.path === p)?.as === 'anyone'));
  } finally {
    await site.stop();
  }
});

test('without a session the staff pages are skipped, and said to be skipped', async () => {
  const site = await serve(expected);
  try {
    const report = await runSmoke(site.base, { sessionCookie: null });

    assert.equal(report.failed, 0);
    assert.equal(report.skipped, CHECKS.filter((c) => c.as === 'staff').length);

    // Skipping quietly is how a smoke test becomes decoration.
    assert.match(formatReport(report), /need a session/);
  } finally {
    await site.stop();
  }
});

test('a site that is down fails rather than throwing', async () => {
  // Nothing listening on this port.
  const report = await runSmoke('http://127.0.0.1:9', { timeoutMs: 1500 });
  assert.ok(report.failed > 0);
  assert.ok(report.results.some((r) => r.status === null));
});

test('nothing answering at all is called out as a network problem', async () => {
  // Ten failures reading "no answer" look identical to an outage, and send
  // somebody to read deployment logs for a proxy on their own desk. This
  // happened on the first real run of this script.
  const report = await runSmoke('http://127.0.0.1:9', { timeoutMs: 1000 });
  const text = formatReport(report);
  assert.match(text, /cannot reach that host/);
});

test('a genuinely broken site is not mistaken for a network problem', async () => {
  const site = await serve(() => 500);
  try {
    const report = await runSmoke(site.base, { sessionCookie: 'pretend-session' });
    const text = formatReport(report);
    assert.ok(report.failed > 0);
    assert.doesNotMatch(text, /cannot reach that host/);
  } finally {
    await site.stop();
  }
});

test('every check carries a reason, so none can be deleted to force a green run', () => {
  for (const check of CHECKS) {
    assert.ok(check.why.length > 15, `${check.path} needs a real reason`);
    assert.ok(check.expect.length > 0, `${check.path} expects nothing`);
  }
});
