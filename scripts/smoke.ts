/**
 * Fetch every page that must answer, and say which did not.
 *
 *   npm run smoke -- https://demo.medcitylms.in
 *
 * Exits non-zero on any failure, so a deploy step or a cron can act on it.
 */

import { runSmoke, formatReport } from '../src/lib/smoke';

const base = process.argv[2] ?? process.env.SMOKE_BASE_URL;

if (!base) {
  console.error('Give it a base URL: npm run smoke -- https://your-host');
  process.exitCode = 2;
}

if (base) {
  const report = await runSmoke(base, {
    sessionCookie: process.env.SMOKE_SESSION?.trim() || null,
  });

  console.log(formatReport(report));

  // `process.exitCode` rather than `process.exit()` throughout. When stdout is
  // a pipe rather than a terminal, which is exactly what happens under
  // `npm run`, writes are asynchronous and process.exit() can cut the report
  // off before a byte of it is flushed. The symptom is a command that prints
  // its own banner and then nothing at all.
  process.exitCode = report.failed > 0 ? 1 : 0;
}
