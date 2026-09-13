import { test } from 'node:test';
import assert from 'node:assert/strict';
import { affiliateLink, canMarkPaid, canVoid, codeProblem, commissionFor, normaliseCode, safeLanding, saleTotals, suggestCode } from '../src/lib/affiliates';

test('codes are suggested from names and checked for shape', () => {
  assert.equal(suggestCode('Priya Menon'), 'PRIYAMENON');
  assert.equal(suggestCode('Dr. A. K. Nair & Sons'), 'DRAKNAIRSO');
  assert.ok(suggestCode('A').length >= 3);
  assert.equal(codeProblem('PRIYA10'), null);
  assert.equal(codeProblem('ab'), 'A code needs at least 3 characters.');
  assert.match(codeProblem('has space') ?? '', /letters, digits/);
  assert.equal(normaliseCode('  priya10 '), 'PRIYA10');
});

test('commission is a share of the order after discount, before tax, rounded down', () => {
  assert.deepEqual(commissionFor({ subtotalPaise: 700000, discountPaise: 100000 }, 10), { basePaise: 600000, commissionPaise: 60000 });
  assert.deepEqual(commissionFor({ subtotalPaise: 100001, discountPaise: 0 }, 12.5), { basePaise: 100001, commissionPaise: 12500 });
  assert.deepEqual(commissionFor({ subtotalPaise: 1000, discountPaise: 2000 }, 10), { basePaise: 0, commissionPaise: 0 });
});

test('links and landings', () => {
  assert.equal(affiliateLink('https://demo.medcitylms.in', 'PRIYA10'), 'https://demo.medcitylms.in/a/PRIYA10');
  assert.equal(affiliateLink('https://demo.medcitylms.in', 'PRIYA10', '/course/german-a1'), 'https://demo.medcitylms.in/a/PRIYA10?to=%2Fcourse%2Fgerman-a1');
  assert.equal(safeLanding('/course/german-a1'), '/course/german-a1');
  assert.equal(safeLanding('https://evil.example'), '/');
  assert.equal(safeLanding('//evil.example'), '/');
  assert.equal(safeLanding(null), '/');
});

test('totals and transitions', () => {
  const t = saleTotals([
    { status: 'PENDING', commissionPaise: 100 },
    { status: 'APPROVED', commissionPaise: 200 },
    { status: 'APPROVED', commissionPaise: 300 },
    { status: 'PAID', commissionPaise: 400 },
    { status: 'VOID', commissionPaise: 500 },
  ]);
  assert.deepEqual(t, { pending: 1, approved: 2, paid: 1, void: 1, owedPaise: 500, paidPaise: 400 });
  assert.equal(canMarkPaid('APPROVED'), true);
  assert.equal(canMarkPaid('PENDING'), false);
  assert.equal(canVoid('APPROVED'), true);
  assert.equal(canVoid('PAID'), false);
});
