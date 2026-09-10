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
  process.exit(2);
}

const report = await runSmoke(base, {
  sessionCookie: process.env.SMOKE_SESSION?.trim() || null,
});

console.log(formatReport(report));
process.exit(report.failed > 0 ? 1 : 0);
