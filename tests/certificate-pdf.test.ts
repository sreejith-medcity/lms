import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderCertificatePdf, safe } from '../src/lib/certificate-pdf';
import { DEFAULT_DESIGN, hexToRgb, readDesign } from '../src/lib/certificate';

test('a certificate renders to a PDF with a QR code and the words on it', async () => {
  const bytes = await renderCertificatePdf({
    design: { ...DEFAULT_DESIGN, signatoryName: 'Dr. Anitha Menon', signatoryRole: 'Director' },
    values: { learner: 'Aparna Menon', course: 'German Language - A1', academy: 'Medcity International Academy', date: '12 September 2026', serial: 'MIA-00042' },
    verifyUrl: 'https://demo.medcitylms.in/verify/abc',
    accentHex: '#322046',
  });
  assert.equal(String.fromCharCode(...bytes.slice(0, 5)), '%PDF-');
  assert.ok(bytes.byteLength > 3000, 'has content');
  const text = Buffer.from(bytes).toString('latin1');
  assert.match(text, /\/Image/, 'the QR code is embedded as an image');
});

test('names outside Latin-1 do not crash the renderer', async () => {
  assert.equal(safe('Müller Straße'), 'Müller Straße');
  assert.equal(safe('Aparna ‘Appu’ Menon'), "Aparna 'Appu' Menon");
  assert.equal(safe('അപർണ Menon'), 'Menon');
  const bytes = await renderCertificatePdf({
    design: DEFAULT_DESIGN,
    values: { learner: 'അപർണ മേനോൻ', course: 'A1', academy: 'Medcity', date: 'today', serial: 'X-1' },
    verifyUrl: 'https://example.com/verify/x',
    accentHex: 'not-a-colour',
  });
  assert.ok(bytes.byteLength > 1000);
});

test('the design reads old rows and bad colours safely', () => {
  const d = readDesign({ headline: 'Hi', body: 'x', accent: 'red' });
  assert.equal(d.accent, '');
  assert.equal(d.showQr, true);
  assert.equal(d.font, 'serif');
  assert.deepEqual(hexToRgb('#ffffff'), { r: 1, g: 1, b: 1 });
});
