import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import {
  payuAmount,
  payuOutcome,
  payuRequestHash,
  payuResponseValid,
  payuVerifyHash,
  phonepeCallbackValid,
  phonepeOutcome,
  phonepeVerify,
  stripeForm,
  stripeOutcome,
  stripeSignatureValid,
} from '../src/lib/payments/signatures';

test('phonepe X-VERIFY is the documented sha256 with the salt index appended', () => {
  const payload = Buffer.from('{"merchantId":"M1"}').toString('base64');
  const expected = `${createHash('sha256').update(`${payload}/pg/v1/paysalt`).digest('hex')}###1`;
  assert.equal(phonepeVerify(payload, '/pg/v1/pay', 'salt', '1'), expected);
  const cb = `${createHash('sha256').update(`${payload}salt`).digest('hex')}###1`;
  assert.equal(phonepeCallbackValid(payload, cb, 'salt', '1'), true);
  assert.equal(phonepeCallbackValid(payload, cb, 'other', '1'), false);
  assert.equal(phonepeCallbackValid(payload, null, 'salt', '1'), false);
  assert.equal(phonepeOutcome('PAYMENT_SUCCESS'), 'PAID');
  assert.equal(phonepeOutcome('PAYMENT_PENDING'), 'PENDING');
  assert.equal(phonepeOutcome('PAYMENT_ERROR'), 'FAILED');
});

test('payu request and response hashes follow the pipe order, and the amount has two decimals', () => {
  const f = { key: 'k', txnid: 'ORD-1', amount: '7000.00', productinfo: 'German A1', firstname: 'Anjali', email: 'a@x.in', udf1: 'o1' };
  const request = createHash('sha512').update('k|ORD-1|7000.00|German A1|Anjali|a@x.in|o1||||||||||salt').digest('hex');
  assert.equal(payuRequestHash(f, 'salt'), request);
  const response = createHash('sha512').update('salt|success||||||||||o1|a@x.in|Anjali|German A1|7000.00|ORD-1|k').digest('hex');
  assert.equal(payuResponseValid({ ...f, status: 'success', hash: response.toUpperCase() }, 'salt'), true);
  assert.equal(payuResponseValid({ ...f, status: 'failure', hash: response }, 'salt'), false);
  assert.equal(payuVerifyHash('k', 'ORD-1', 'salt'), createHash('sha512').update('k|verify_payment|ORD-1|salt').digest('hex'));
  assert.equal(payuAmount(700000), '7000.00');
  assert.equal(payuAmount(123456), '1234.56');
  assert.equal(payuOutcome('success'), 'PAID');
  assert.equal(payuOutcome('pending'), 'PENDING');
  assert.equal(payuOutcome('failure'), 'FAILED');
});

test('stripe signatures verify within tolerance and the form encoding nests keys', () => {
  const body = '{"id":"evt_1"}';
  const t = 1_700_000_000;
  const sig = createHmac('sha256', 'whsec').update(`${t}.${body}`).digest('hex');
  assert.equal(stripeSignatureValid(body, `t=${t},v1=${sig}`, 'whsec', t + 10), true);
  assert.equal(stripeSignatureValid(body, `t=${t},v1=${sig}`, 'whsec', t + 1000), false);
  assert.equal(stripeSignatureValid(body, `t=${t},v1=deadbeef`, 'whsec', t), false);
  assert.equal(stripeSignatureValid(body, null, 'whsec', t), false);
  assert.equal(
    stripeForm({ mode: 'payment', line_items: [{ quantity: 1, price_data: { currency: 'inr', unit_amount: 700000 } }] }),
    'mode=payment&line_items%5B0%5D%5Bquantity%5D=1&line_items%5B0%5D%5Bprice_data%5D%5Bcurrency%5D=inr&line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=700000',
  );
  assert.equal(stripeOutcome('paid', 'complete'), 'PAID');
  assert.equal(stripeOutcome('unpaid', 'expired'), 'FAILED');
  assert.equal(stripeOutcome('unpaid', 'open'), 'PENDING');
});
