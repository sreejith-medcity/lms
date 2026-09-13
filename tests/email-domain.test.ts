import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dkimPublicValue, dnsRecordsFor, domainProblem, judgeDns, localPartProblem, verified } from '../src/lib/email-domain-rules';

const PEM = '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A\nMIIBCgKCAQEA1234\n-----END PUBLIC KEY-----\n';

test('domains and local parts are checked plainly', () => {
  assert.equal(domainProblem('academy.in'), null);
  assert.equal(domainProblem('https://academy.in'), 'That is not a domain name. Something like academy.in, without http or a path.');
  assert.equal(domainProblem(''), 'Enter the domain.');
  assert.equal(localPartProblem('noreply'), null);
  assert.equal(localPartProblem('no reply'), 'Letters, digits, dots, hyphens and underscores only.');
});

test('the three records name the hosts a DNS panel wants', () => {
  const r = dnsRecordsFor('academy.in', 'lms', PEM, 'spf.medcitylms.in');
  assert.equal(r[0].host, 'lms._domainkey.academy.in');
  assert.equal(r[0].value, `v=DKIM1; k=rsa; p=${dkimPublicValue(PEM)}`);
  assert.equal(r[1].value, 'v=spf1 include:spf.medcitylms.in ~all');
  assert.equal(r[2].host, '_dmarc.academy.in');
});

test('DNS answers are judged, chunked TXT records joined first', () => {
  const key = dkimPublicValue(PEM);
  const good = judgeDns({ dkim: [[`v=DKIM1; k=rsa; p=${key.slice(0, 10)}`, key.slice(10)]], spf: [['v=spf1 include:spf.medcitylms.in ~all']], dmarc: [['v=DMARC1; p=none']] }, PEM, 'spf.medcitylms.in');
  assert.deepEqual(good, { dkimOk: true, spfOk: true, dmarcOk: true, note: 'All three records resolve.' });
  assert.equal(verified(good), true);
  const bad = judgeDns({ dkim: [['v=DKIM1; p=other']], spf: [['v=spf1 include:_spf.google.com ~all']], dmarc: null }, PEM, 'spf.medcitylms.in');
  assert.equal(bad.dkimOk, false);
  assert.equal(bad.spfOk, false);
  assert.equal(verified(bad), false);
  assert.match(bad.note, /key does not match/);
  assert.match(bad.note, /does not include the platform/);
});
