/**
 * Time the main pages.
 *
 *   npm run perf -- https://demo.medcitylms.in
 *   PERF_RUNS=10 npm run perf -- https://demo.medcitylms.in /course/some-course
 *
 * On the VPS itself, against the app with no network in between (the
 * numbers are then the server's alone):
 *
 *   PERF_HOST=demo.medcitylms.in npm run perf -- http://127.0.0.1:3000
 *
 * PERF_SESSION, the value of a staff member's mlms_session cookie, adds the
 * admin pages. Extra paths after the base are timed too. Nothing is written.
 */

import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { CHECKS } from '../src/lib/smoke';
import { FLOOR_PATH, formatTable, summarise, type Sample } from '../src/lib/perf';

const base = (process.argv[2] ?? '').replace(/\/+$/, '');
const extra = process.argv.slice(3).filter((p) => p.startsWith('/'));
const runs = Math.max(2, Math.min(50, Number(process.env.PERF_RUNS ?? 5) || 5));
const hostHeader = process.env.PERF_HOST?.trim() || null;
const session = process.env.PERF_SESSION?.trim() || null;

function fetchOnce(path: string, staff: boolean): Promise<Sample> {
  return new Promise((resolve) => {
    const url = new URL(base + path);
    const started = performance.now();
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const headers: Record<string, string> = { 'user-agent': 'medcity-perf/1', accept: 'text/html,application/json' };
    if (hostHeader) headers.host = hostHeader;
    if (staff && session) headers.cookie = `mlms_session=${session}`;
    const req = send(url, { method: 'GET', headers }, (res) => {
      const ttfb = performance.now() - started;
      let bytes = 0;
      res.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
      });
      res.on('end', () => resolve({ path, ttfb, total: performance.now() - started, bytes, status: res.statusCode ?? 0 }));
    });
    req.on('error', () => resolve({ path, ttfb: performance.now() - started, total: performance.now() - started, bytes: 0, status: 0 }));
    req.setTimeout(30_000, () => req.destroy());
    req.end();
  });
}

if (!/^https?:\/\//.test(base)) {
  console.error('Give it a base URL: npm run perf -- https://your-host');
  process.exitCode = 2;
} else {
  const pages = [
    { path: FLOOR_PATH, staff: false },
    ...CHECKS.filter((c) => c.expect.includes(200) && (c.as === 'anyone' || session)).map((c) => ({ path: c.path, staff: c.as === 'staff' })),
    ...extra.map((path) => ({ path, staff: Boolean(session) })),
  ];
  const samples: Sample[] = [];
  /* Round-robin rather than page by page, so a slow minute on the box is spread over every page instead of landing on one. */
  for (let i = 0; i < runs; i += 1) {
    for (const p of pages) samples.push(await fetchOnce(p.path, p.staff));
  }
  const { rows, floor } = summarise(samples);
  console.log(`${base}${hostHeader ? ` (Host: ${hostHeader})` : ''}, ${runs} runs a page, ${session ? 'with' : 'without'} a staff session, ${new Date().toISOString()}\n`);
  console.log(formatTable(rows, floor));
  process.exitCode = rows.some((r) => r.status === 0 || r.status >= 500) ? 1 : 0;
}
