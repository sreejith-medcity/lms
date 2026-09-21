/**
 * The next invoice number, worked out from the last one issued.
 *
 * It used to be a row count plus one, which is right exactly until a number
 * is skipped or a row removed: after that the count keeps producing a number
 * that already exists, the unique index refuses it, and every payment from
 * then on ends as money taken with no enrolment granted. Reading the highest
 * number actually issued cannot drift that way.
 *
 * Numbers are per academy and per year, which is what a GST return expects,
 * and they never go backwards: a malformed or missing last number restarts
 * the year rather than colliding with something already issued.
 *
 * The number is unique across the whole deployment, so a second academy
 * carries a series of its own in the prefix (INV-ACME-2026-00001): without
 * it, the second academy to sell anything in a year would collide with the
 * first's 00001 and be unable to invoice at all. The first academy keeps
 * the plain series it started with.
 */

export function invoicePrefix(year: number, series = ''): string {
  const tag = series
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .slice(0, 12);
  return tag ? `INV-${tag}-${year}-` : `INV-${year}-`;
}

export function nextInvoiceNumber(latest: string | null | undefined, prefix: string): string {
  const tail = latest?.startsWith(prefix) ? latest.slice(prefix.length) : '';
  const last = /^\d+$/.test(tail) ? Number.parseInt(tail, 10) : 0;
  const next = Number.isSafeInteger(last) && last > 0 ? last + 1 : 1;
  return `${prefix}${String(next).padStart(5, '0')}`;
}
