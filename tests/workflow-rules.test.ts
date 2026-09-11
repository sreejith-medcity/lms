import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  conditionHolds,
  describeDelay,
  dueAt,
  eventMatches,
  normaliseTag,
  parseStepConfig,
  parseTriggerFilters,
  runKey,
  stepProblem,
} from '../src/lib/workflow-rules';

test('trigger filters narrow by product, batch and outcome, and default wide open', () => {
  const open = parseTriggerFilters(null);
  assert.deepEqual(open, { productIds: [], batchIds: [], days: 7, outcome: 'ANY' });
  assert.equal(eventMatches(open, { productId: 'p1' }), true);

  const narrow = parseTriggerFilters({ productIds: ['p1'], batchIds: ['b2'], days: '30', outcome: 'FAILED' });
  assert.equal(narrow.days, 30);
  assert.equal(eventMatches(narrow, { productId: 'p1', batchId: 'b2', data: { passed: false } }), true);
  assert.equal(eventMatches(narrow, { productId: 'p9', batchId: 'b2', data: { passed: false } }), false, 'wrong product');
  assert.equal(eventMatches(narrow, { productId: 'p1', batchId: 'b2', data: { passed: true } }), false, 'passed, wanted failed');
  assert.equal(eventMatches(narrow, { productId: 'p1', batchId: 'b2' }), false, 'no outcome on the event');
  assert.equal(eventMatches(parseTriggerFilters({ days: 0 }), {}), true);
  assert.equal(parseTriggerFilters({ days: 0 }).days, 7, 'nonsense days fall back');
});

test('step settings are read defensively and complained about in words', () => {
  const c = parseStepConfig({ channel: 'EMAIL', body: 'Hi {{name}}', points: '250', days: '3', url: 'ftp://x' });
  assert.equal(c.channel, 'EMAIL');
  assert.equal(c.points, 250);
  assert.equal(c.days, 3);
  assert.equal(stepProblem('SEND_MESSAGE', c), null);
  assert.equal(stepProblem('SEND_MESSAGE', parseStepConfig({ channel: 'WHATSAPP', body: 'x' })), 'WhatsApp needs an approved template; pick one rather than writing text here.');
  assert.equal(stepProblem('SEND_MESSAGE', parseStepConfig({ templateId: 't1' })), null);
  assert.equal(stepProblem('SEND_MESSAGE', parseStepConfig({})), 'Pick a channel or a template.');
  assert.equal(stepProblem('WEBHOOK', c), 'The URL must start with https://');
  assert.equal(stepProblem('ADD_POINTS', parseStepConfig({ points: -5 })), 'How many points?');
  assert.equal(stepProblem('CONDITION', parseStepConfig({ condition: 'ENROLLED_IN' })), 'Pick the course.');
  assert.equal(stepProblem('CONDITION', parseStepConfig({ condition: 'HAS_PAID' })), null);
  assert.equal(stepProblem('NONSENSE', c), 'Unknown step.');
});

test('conditions read the facts the runner gathered', () => {
  const now = new Date('2026-09-11T00:00:00Z');
  const facts = { enrolledProductIds: ['p1'], tags: ['needs a call'], hasPaid: false, lastActiveAt: new Date('2026-09-01T00:00:00Z') };
  assert.equal(conditionHolds(parseStepConfig({ condition: 'ENROLLED_IN', productId: 'p1' }), facts, now), true);
  assert.equal(conditionHolds(parseStepConfig({ condition: 'NOT_ENROLLED_IN', productId: 'p1' }), facts, now), false);
  assert.equal(conditionHolds(parseStepConfig({ condition: 'HAS_TAG', tag: 'needs a call' }), facts, now), true);
  assert.equal(conditionHolds(parseStepConfig({ condition: 'HAS_PAID' }), facts, now), false);
  assert.equal(conditionHolds(parseStepConfig({ condition: 'ACTIVE_WITHIN', days: 7 }), facts, now), false);
  assert.equal(conditionHolds(parseStepConfig({ condition: 'INACTIVE_FOR', days: 7 }), facts, now), true);
  assert.equal(conditionHolds(parseStepConfig({ condition: 'INACTIVE_FOR', days: 7 }), { ...facts, lastActiveAt: null }, now), true, 'never active counts as inactive');
  assert.equal(conditionHolds(parseStepConfig({}), facts, now), false, 'no condition never passes');
});

test('timing and keys', () => {
  const now = new Date('2026-09-11T10:00:00Z');
  const steps = [{ delayMinutes: 0 }, { delayMinutes: 1440 }];
  assert.equal(dueAt(steps, 0, now).getTime(), now.getTime());
  assert.equal(dueAt(steps, 1, now).getTime(), now.getTime() + 864e5);
  assert.equal(dueAt(steps, 5, now).getTime(), now.getTime(), 'past the end is due now');
  assert.equal(describeDelay(0), 'straight away');
  assert.equal(describeDelay(60), '1 hour');
  assert.equal(describeDelay(2880), '2 days');
  assert.equal(describeDelay(45), '45 minutes');
  assert.equal(runKey('w', true, 'u', 's'), 'w:u');
  assert.equal(runKey('w', false, 'u', 's'), 'w:u:s');
  assert.equal(normaliseTag('  Needs a   Call '), 'needs a call');
});
