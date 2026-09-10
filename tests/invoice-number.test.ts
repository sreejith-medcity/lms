import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invoicePrefix, nextInvoiceNumber } from '../src/lib/invoice-number';

const P = invoicePrefix(2026);

test('the first invoice of a year starts the sequence', () => {
  assert.equal(nextInvoiceNumber(null, P), 'INV-2026-00001');
  assert.equal(nextInvoiceNumber(undefined, P), 'INV-2026-00001');
});

test('the next one follows the highest issued, not a row count', () => {
  assert.equal(nextInvoiceNumber('INV-2026-00007', P), 'INV-2026-00008');
  // The case that broke it: three invoices exist but the last is number nine,
  // because six were issued and three were removed. A count would say four,
  // which is taken, and every payment after it would fail on the index.
  assert.equal(nextInvoiceNumber('INV-2026-00009', P), 'INV-2026-00010');
});

test('a new year restarts rather than continuing the old sequence', () => {
  assert.equal(nextInvoiceNumber('INV-2026-00042', invoicePrefix(2027)), 'INV-2027-00001');
});

test('a number that is not one restarts instead of producing nonsense', () => {
  for (const junk of ['INV-2026-abc', 'INV-2026-', 'nonsense', '', 'INV-2026-00-1']) {
    assert.equal(nextInvoiceNumber(junk, P), 'INV-2026-00001', junk);
  }
});

test('the sequence keeps its width past five digits rather than truncating', () => {
  assert.equal(nextInvoiceNumber('INV-2026-99999', P), 'INV-2026-100000');
});

test('numbers sort in issue order, which is what the lookup relies on', () => {
  const issued = ['INV-2026-00001', 'INV-2026-00002', 'INV-2026-00010'];
  assert.deepEqual([...issued].sort(), issued);
});
