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
 */

export function invoicePrefix(year: number): string {
  return `INV-${year}-`;
}

export function nextInvoiceNumber(latest: string | null | undefined, prefix: string): string {
  const tail = latest?.startsWith(prefix) ? latest.slice(prefix.length) : '';
  const last = /^\d+$/.test(tail) ? Number.parseInt(tail, 10) : 0;
  const next = Number.isSafeInteger(last) && last > 0 ? last + 1 : 1;
  return `${prefix}${String(next).padStart(5, '0')}`;
}
