import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPaidAmount, explainAmount } from '../src/lib/payment-amount';

const rupees = (paise: number) => `₹${(paise / 100).toFixed(2)}`;

test('the ordinary case: the academy pays the fee, so the amounts match', () => {
  const check = checkPaidAmount({ grossPaise: 826000, orderPaise: 826000, feePaise: 19494 });
  assert.equal(check.ok, true);
  assert.equal(check.customerPaidFeePaise, 0);
});

test('the customer paying the fee is a real payment, not tampering', () => {
  // The case that stopped a live test: ₹8,260 order, 3% fee plus 18% GST on
  // the fee, captured as ₹8,552.40.
  const check = checkPaidAmount({ grossPaise: 855240, orderPaise: 826000, feePaise: 29240 });
  assert.equal(check.ok, true);
  assert.equal(check.customerPaidFeePaise, 29240);
});

test('Razorpay rounding the GST on its fee does not refuse the payment', () => {
  for (const fee of [29239, 29240, 29241, 29200]) {
    const check = checkPaidAmount({ grossPaise: 855240, orderPaise: 826000, feePaise: fee });
    assert.equal(check.ok, true, `fee ${fee}`);
  }
});

test('an overpayment that is not the fee is still refused', () => {
  const check = checkPaidAmount({ grossPaise: 900000, orderPaise: 826000, feePaise: 29240 });
  assert.equal(check.ok, false);
  assert.equal(check.reason, 'NOT_THE_FEE');
});

test('an overpayment with no fee reported is refused', () => {
  const check = checkPaidAmount({ grossPaise: 855240, orderPaise: 826000 });
  assert.equal(check.ok, false);
  assert.equal(check.reason, 'OVERPAID');
});

test('underpaying is refused whatever the fee says', () => {
  const check = checkPaidAmount({ grossPaise: 100, orderPaise: 826000, feePaise: 29240 });
  assert.equal(check.ok, false);
  assert.equal(check.reason, 'UNDERPAID');
});

test('a negative or nonsense fee cannot be used to widen the gap', () => {
  const check = checkPaidAmount({ grossPaise: 900000, orderPaise: 826000, feePaise: -74000 });
  assert.equal(check.ok, false);
});

test('each outcome explains itself in one sentence', () => {
  const feeBorne = explainAmount(
    checkPaidAmount({ grossPaise: 855240, orderPaise: 826000, feePaise: 29240 }),
    rupees,
  );
  assert.match(feeBorne, /gateway fee/);

  const refused = explainAmount(
    checkPaidAmount({ grossPaise: 900000, orderPaise: 826000, feePaise: 1 }),
    rupees,
  );
  assert.match(refused, /not the gateway/);

  const short = explainAmount(checkPaidAmount({ grossPaise: 10, orderPaise: 826000 }), rupees);
  assert.match(short, /less than/);
});
