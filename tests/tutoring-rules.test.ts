import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classDayOnOrAfter,
  classDays,
  clashes,
  covers,
  daysBetween,
  hoursOf,
  learnerLeaveProblem,
  milestonesDue,
  minuteOf,
  openStartTimes,
  pickTutor,
  slotLabel,
  timeLabel,
  tutorLeavePlan,
  weekdaysLabel,
  type TutorState,
} from '../src/lib/tutoring/rules';

const MON_SAT = [1, 2, 3, 4, 5, 6];
const evening = (userId: string, taken: TutorState['taken'] = []): TutorState => ({
  userId,
  windows: MON_SAT.map((weekday) => ({ weekday, startMinute: 18 * 60, endMinute: 21 * 60 })),
  taken,
});

test('a tutor covers a slot only when every class day is inside their hours', () => {
  const t = evening('a');
  assert.ok(covers(t.windows, { weekdays: MON_SAT, startMinute: 19 * 60, minutes: 60 }));
  assert.ok(!covers(t.windows, { weekdays: MON_SAT, startMinute: 20 * 60 + 30, minutes: 60 }), 'runs past nine');
  assert.ok(!covers(t.windows, { weekdays: [0, 1], startMinute: 19 * 60, minutes: 60 }), 'Sunday is not marked');
  assert.ok(!covers(t.windows, { weekdays: [], startMinute: 19 * 60, minutes: 60 }));
});

test('slots clash on a shared weekday with overlapping times, and only then', () => {
  const a = { weekdays: [1, 3, 5], startMinute: 600, minutes: 60 };
  assert.ok(clashes(a, { weekdays: [5, 6], startMinute: 630, minutes: 60 }));
  assert.ok(!clashes(a, { weekdays: [2, 4], startMinute: 600, minutes: 60 }), 'no day in common');
  assert.ok(!clashes(a, { weekdays: [1], startMinute: 660, minutes: 60 }), 'back to back is not a clash');
});

test('the learner goes to the free tutor carrying the least', () => {
  const slot = { weekdays: MON_SAT, startMinute: 19 * 60, minutes: 60 };
  const busy = evening('a', [{ weekdays: MON_SAT, startMinute: 19 * 60, minutes: 60 }]);
  const loaded = evening('b', [{ weekdays: MON_SAT, startMinute: 18 * 60, minutes: 60 }]);
  const idle = evening('c');
  assert.equal(pickTutor([busy, loaded, idle], slot), 'c');
  assert.equal(pickTutor([busy, loaded], slot), 'b');
  assert.equal(pickTutor([busy], slot), null);
  assert.equal(pickTutor([loaded, idle], slot, ['c']), 'b', 'the tutor on leave is passed over');
  assert.equal(pickTutor([{ ...idle, away: true }], slot), null);
});

test('the times offered are those somebody could take', () => {
  const times = openStartTimes([evening('a', [{ weekdays: MON_SAT, startMinute: 18 * 60, minutes: 60 }])], { weekdays: MON_SAT, minutes: 60 });
  assert.deepEqual(times, [19 * 60, 19 * 60 + 30, 20 * 60]);
  assert.deepEqual(openStartTimes([], { weekdays: MON_SAT, minutes: 60 }), []);
});

test('class days follow the weekdays and step over the days skipped', () => {
  /* 5 October 2026 is a Monday. */
  assert.equal(classDayOnOrAfter('2026-10-04', MON_SAT), '2026-10-05');
  assert.deepEqual(classDays('2026-10-05', [1, 3, 5], 4), ['2026-10-05', '2026-10-07', '2026-10-09', '2026-10-12']);
  assert.deepEqual(classDays('2026-10-05', [1, 3, 5], 2, (d) => d === '2026-10-07'), ['2026-10-05', '2026-10-09']);
  assert.deepEqual(classDays('2026-10-05', [], 3), []);
});

test('a short leave calls classes off, a long one hands the groups over', () => {
  assert.equal(daysBetween('2026-10-05', '2026-10-05'), 1);
  assert.equal(daysBetween('2026-10-28', '2026-11-03'), 7);
  assert.equal(tutorLeavePlan('2026-10-05', '2026-10-11'), 'CANCEL');
  assert.equal(tutorLeavePlan('2026-10-05', '2026-10-12'), 'REASSIGN');
  assert.equal(tutorLeavePlan('2026-10-12', '2026-10-05'), null);
});

test('a learner takes up to three days, from today on', () => {
  assert.equal(learnerLeaveProblem('2026-10-05', '2026-10-07', '2026-10-02'), null);
  assert.match(learnerLeaveProblem('2026-10-05', '2026-10-08', '2026-10-02') ?? '', /up to 3 days/);
  assert.match(learnerLeaveProblem('2026-10-01', '2026-10-02', '2026-10-02') ?? '', /today or later/);
  assert.ok(learnerLeaveProblem('x', 'y', '2026-10-02'));
});

test('feedback falls due after classes 5, 10 and 15 and at the end, once each', () => {
  assert.deepEqual(milestonesDue(4, 30, []), []);
  assert.deepEqual(milestonesDue(5, 30, []), [5]);
  assert.deepEqual(milestonesDue(11, 30, [5]), [10]);
  assert.deepEqual(milestonesDue(30, 30, [5, 10, 15]), [0]);
  assert.deepEqual(milestonesDue(30, 30, [5, 10, 15, 0]), []);
  /* A twelve-class course asks at 5 and 10, then at the end; 15 never comes. */
  assert.deepEqual(milestonesDue(12, 12, [5, 10]), [0]);
  /* A ten-class course: the tenth class is the end, asked once. */
  assert.deepEqual(milestonesDue(10, 10, [5]), [0]);
});

test('labels and fields', () => {
  assert.equal(timeLabel(19 * 60 + 30), '7:30 pm');
  assert.equal(timeLabel(0), '12:00 am');
  assert.equal(slotLabel({ weekdays: [1], startMinute: 660, minutes: 60 }), '11:00 am to 12:00 pm');
  assert.equal(weekdaysLabel(MON_SAT), 'Mon to Sat');
  assert.equal(weekdaysLabel([1, 3, 5]), 'Mon, Wed, Fri');
  assert.equal(minuteOf('19:30'), 1170);
  assert.equal(minuteOf('25:00'), null);
  assert.equal(hoursOf(90), 1.5);
  assert.equal(hoursOf(100), 1.67);
});
