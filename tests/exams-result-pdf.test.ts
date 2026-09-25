import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderResultPdf } from '../src/lib/exams/result-pdf';

test('a result prints, umlauts and a long note included', async () => {
  const bytes = await renderResultPdf({
    academy: 'Medcity Academy',
    accentHex: '#322046',
    candidate: 'Anjali Nair',
    test: 'telc Deutsch B1',
    subtitle: 'Zertifikat Deutsch',
    date: '25 September 2026',
    mode: 'exam mode, on the clock',
    reference: 'K7M2QA-ABC123',
    total: 212.5,
    maxPoints: 300,
    passed: true,
    modules: [
      { name: 'Leseverstehen', points: 60, max: 75 },
      { name: 'Hörverstehen', points: null, max: 75 },
      { name: 'Mündlicher Ausdruck', points: 52.5, max: 75 },
    ],
    conditions: [{ name: 'Schriftliche Prüfung gesamt', met: true, got: 160, min: 135, max: 225 }],
    note: 'A practice paper in the format of the exam. '.repeat(12),
  });
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), '%PDF-');
  assert.ok(bytes.byteLength > 1500);
});
