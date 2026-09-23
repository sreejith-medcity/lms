import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allDone,
  currentSection,
  doneSections,
  endPreparation,
  mayAnswer,
  mayTakeNotes,
  sectionStatus,
  secondsLeft,
  startClock,
  type SittingClockState,
} from '../src/lib/exams/clock';
import { TELC_B1 } from '../src/lib/exams/formats/telc';

const t0 = new Date('2026-09-23T10:00:00Z');
const at = (min: number, sec = 0) => new Date(t0.getTime() + min * 60_000 + sec * 1000);
const fresh = (mode: 'exam' | 'practice' = 'exam', onlySection: string | null = null): SittingClockState => ({ mode, onlySection, clocks: {}, done: [] });

test('in exam mode the sections come in order, each waiting to be started', () => {
  const s = fresh();
  assert.equal(currentSection(TELC_B1, s, t0), 'lv_sb');
  assert.equal(sectionStatus(TELC_B1, s, 'lv_sb', t0), 'waiting');
  assert.equal(sectionStatus(TELC_B1, s, 'hv', t0), 'upcoming');
  assert.equal(mayAnswer(TELC_B1, s, 'lv_sb', t0), false, 'not before it is started');
});

test('a started section takes answers until its clock and twenty seconds of grace, then closes for good', () => {
  const s = fresh();
  s.clocks.lv_sb = startClock(TELC_B1, 'lv_sb', t0);
  assert.equal(s.clocks.lv_sb.phase, 'exam');
  assert.equal(secondsLeft(s.clocks.lv_sb, at(60)), 30 * 60);
  assert.equal(mayAnswer(TELC_B1, s, 'lv_sb', at(89, 59)), true);
  assert.equal(mayAnswer(TELC_B1, s, 'lv_sb', at(90, 15)), true, 'the keystroke in flight');
  assert.equal(mayAnswer(TELC_B1, s, 'lv_sb', at(90, 25)), false);
  assert.deepEqual(doneSections(TELC_B1, s, at(90, 25)), ['lv_sb']);
  assert.equal(currentSection(TELC_B1, s, at(91)), 'hv');
  assert.equal(sectionStatus(TELC_B1, s, 'lv_sb', at(91)), 'closed');
});

test('finishing a section early closes it and moves on; there is no way back', () => {
  const s = fresh();
  s.clocks.lv_sb = startClock(TELC_B1, 'lv_sb', t0);
  s.done.push('lv_sb');
  assert.equal(currentSection(TELC_B1, s, at(40)), 'hv');
  assert.equal(mayAnswer(TELC_B1, s, 'lv_sb', at(40)), false);
});

test('speaking starts with twenty minutes of preparation, notes only, then its own fifteen', () => {
  const s = fresh('exam', 'ma');
  assert.equal(currentSection(TELC_B1, s, t0), 'ma');
  s.clocks.ma = startClock(TELC_B1, 'ma', t0);
  assert.equal(s.clocks.ma.phase, 'prep');
  assert.equal(sectionStatus(TELC_B1, s, 'ma', at(5)), 'prep');
  assert.equal(mayAnswer(TELC_B1, s, 'ma', at(5)), false, 'nothing recorded during preparation');
  assert.equal(mayTakeNotes(TELC_B1, s, 'ma', at(5)), true);
  s.clocks.ma = endPreparation(TELC_B1, s.clocks.ma, 'ma', at(12));
  assert.equal(s.clocks.ma.phase, 'exam');
  assert.equal(secondsLeft(s.clocks.ma, at(12)), 15 * 60, 'ended early: the exam clock starts now');
  assert.equal(mayAnswer(TELC_B1, s, 'ma', at(20)), true);
});

test('preparation ended after its time starts the exam from the preparation deadline, not from the late press', () => {
  const clock = endPreparation(TELC_B1, startClock(TELC_B1, 'ma', t0), 'ma', at(30));
  assert.equal(clock.deadline, at(35).toISOString());
});

test('a tutor-set part is the whole sitting; practice mode has no clocks and no order', () => {
  const part = fresh('exam', 'hv');
  assert.equal(sectionStatus(TELC_B1, part, 'lv_sb', t0), 'closed');
  part.done.push('hv');
  assert.equal(allDone(TELC_B1, part, t0), true);
  const practice = fresh('practice');
  assert.equal(sectionStatus(TELC_B1, practice, 'sa', t0), 'open');
  assert.equal(mayAnswer(TELC_B1, practice, 'ma', at(600)), true);
});
