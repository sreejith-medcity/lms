import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capReached, cycleAmount, invoiceNumber, invoiceTotals, metricValue, overageLines, periodEnd, standing } from '../src/lib/platform/billing-rules';

const plan = { monthlyPaise: 999000, quarterlyPaise: 2847150, annualPaise: null };

test('a cycle costs the discounted figure when there is one, multiples of monthly otherwise', () => {
  assert.equal(cycleAmount(plan, 'MONTHLY'), 999000);
  assert.equal(cycleAmount(plan, 'QUARTERLY'), 2847150);
  assert.equal(cycleAmount(plan, 'ANNUAL'), 999000 * 12);
  assert.equal(periodEnd(new Date('2026-01-31T00:00:00Z'), 'MONTHLY').toISOString(), '2026-03-03T00:00:00.000Z');
  assert.equal(periodEnd(new Date('2026-09-13T00:00:00Z'), 'QUARTERLY').toISOString(), '2026-12-13T00:00:00.000Z');
});

test('overage is only what is past the included amount, only where priced', () => {
  const limits = [
    { metric: 'ACTIVE_LEARNERS', included: 500, hardCap: null, overagePaisePerUnit: 500 },
    { metric: 'STORAGE_BYTES', included: 100, hardCap: 100, overagePaisePerUnit: 0 },
  ];
  const lines = overageLines([{ metric: 'ACTIVE_LEARNERS', quantity: 620 }, { metric: 'STORAGE_BYTES', quantity: 150 }], limits);
  assert.deepEqual(lines, [{ metric: 'ACTIVE_LEARNERS', used: 620, included: 500, over: 120, paise: 60000 }]);
  assert.deepEqual(invoiceTotals(999000, lines), { subtotalPaise: 999000, overagePaise: 60000, taxPaise: 190620, totalPaise: 1249620 });
  assert.equal(capReached(limits, 'STORAGE_BYTES', 100), true);
  assert.equal(capReached(limits, 'ACTIVE_LEARNERS', 9999), false);
});

test('the nightly standing follows severity', () => {
  const now = new Date('2026-09-13T00:00:00Z');
  const base = { tenantStatus: 'ACTIVE', subscriptionStatus: 'ACTIVE', currentPeriodEnd: new Date('2026-10-01T00:00:00Z'), trialEndsAt: null, oldestDueUnpaid: null };
  assert.deepEqual(standing(base, now), { action: 'none' });
  assert.deepEqual(standing({ ...base, currentPeriodEnd: new Date('2026-09-12T00:00:00Z') }, now), { action: 'renew' });
  assert.deepEqual(standing({ ...base, tenantStatus: 'TRIALING', subscriptionStatus: 'TRIALING', currentPeriodEnd: new Date('2026-09-12T00:00:00Z') }, now), { action: 'trial-ended' });
  assert.deepEqual(standing({ ...base, oldestDueUnpaid: new Date('2026-09-10T00:00:00Z') }, now), { action: 'past-due' });
  assert.deepEqual(standing({ ...base, tenantStatus: 'PAST_DUE', oldestDueUnpaid: new Date('2026-09-10T00:00:00Z') }, now), { action: 'none' });
  assert.deepEqual(standing({ ...base, tenantStatus: 'PAST_DUE', oldestDueUnpaid: new Date('2026-08-20T00:00:00Z') }, now), { action: 'suspend' });
  assert.deepEqual(standing({ ...base, tenantStatus: 'SUSPENDED', oldestDueUnpaid: new Date('2026-08-20T00:00:00Z') }, now), { action: 'none' });
});

test('numbers and sizes read plainly', () => {
  assert.equal(invoiceNumber(2026, 7), 'PLT-2026-00007');
  assert.equal(metricValue('STORAGE_BYTES', 2.5 * 1024 ** 3), '2.5 GB');
  assert.equal(metricValue('ACTIVE_LEARNERS', 1250), '1,250');
});
