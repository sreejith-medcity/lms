import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moneyText, renderMoneyPdf } from '../src/lib/money-pdf';

test('amounts are written with the currency code and Indian grouping', () => {
  assert.equal(moneyText(700000, 'INR'), 'INR 7,000.00');
  assert.equal(moneyText(-125050, 'INR'), '-INR 1,250.50');
  assert.equal(moneyText(1234567800, 'INR'), 'INR 1,23,45,678.00');
});

test('an invoice renders to a PDF', async () => {
  const bytes = await renderMoneyPdf({
    doc: {
      kind: 'INVOICE',
      number: 'MIA/26-27/00042',
      issuedAt: new Date('2026-09-12T10:00:00Z'),
      currency: 'INR',
      issuer: { name: 'Medcity International Academy', legalName: 'Medcity International Academy Pvt Ltd', addressLine: 'MG Road', city: 'Kochi', state: 'Kerala', pincode: '682016', gstin: '32AAAAA0000A1Z5', pan: 'AAAAA0000A', supportEmail: 'help@medcity.example', contactNumber: '+91 98470 00000' },
      recipient: { name: 'Aparna Menon', email: 'aparna@example.com', phone: '+91 90000 00000' },
      lines: [{ title: 'German Language - A1', amountPaise: 1000000, detail: 'Less discount 3000.00' }],
      totals: [{ label: 'Subtotal', amountPaise: 1000000 }, { label: 'Discount', amountPaise: -300000 }, { label: 'CGST 9%', amountPaise: 63000 }, { label: 'SGST 9%', amountPaise: 63000 }, { label: 'Total', amountPaise: 826000, strong: true }],
      paidBy: 'upi',
      reference: 'pay_ABC123',
      note: 'Order MIA-1001. Place of supply: Kerala.',
      ownerId: 'u1',
    },
  });
  assert.equal(String.fromCharCode(...bytes.slice(0, 5)), '%PDF-');
  assert.ok(bytes.byteLength > 1500);
});
