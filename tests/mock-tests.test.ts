import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockTestLine, mockTestsLeft, sumMockTestAttempts } from '../src/lib/mock-tests';

test('courses that say nothing leave the partner default in place', () => {
  assert.equal(sumMockTestAttempts([]), null);
  assert.equal(sumMockTestAttempts([{ mockTestAttempts: null }, { mockTestAttempts: null }]), null);
});

test('allowances add up across courses, and a zero is a real zero', () => {
  assert.equal(sumMockTestAttempts([{ mockTestAttempts: 3 }, { mockTestAttempts: null }, { mockTestAttempts: 2 }]), 5);
  assert.equal(sumMockTestAttempts([{ mockTestAttempts: 0 }]), 0);
  assert.equal(sumMockTestAttempts([{ mockTestAttempts: -4 }, { mockTestAttempts: 1 }]), 1);
});

test('what is left never goes below zero', () => {
  assert.equal(mockTestsLeft({ limit: null, used: 9 }), null);
  assert.equal(mockTestsLeft({ limit: 5, used: 2 }), 3);
  assert.equal(mockTestsLeft({ limit: 5, used: 7 }), 0);
});

test('the line under the button', () => {
  assert.equal(mockTestLine({ limit: null, used: 4 }), null);
  assert.equal(mockTestLine({ limit: 5, used: 2 }), '2 of 5 used');
  assert.equal(mockTestLine({ limit: 5, used: 5 }), '5 of 5 used, none left');
  assert.equal(mockTestLine({ limit: 5, used: 7 }), '5 of 5 used, none left');
});
