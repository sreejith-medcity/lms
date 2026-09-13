import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atRisk, currentStreak, standings, streakLine, tiersDue, touch, type Stats } from '../src/lib/badges';

const stats = (over: Partial<Stats>): Stats => ({ lessons: 0, classes: 0, streak: 0, courses: 0, perfect: 0, homeworkOnTime: 0, questions: 0, reviews: 0, earlyBird: 0, ...over });

test('tiers come due as counts pass thresholds and are never awarded twice', () => {
  const due = tiersDue(stats({ lessons: 12, classes: 1 }), [{ badgeKey: 'lessons', tier: 1 }]);
  assert.deepEqual(due, [
    { badgeKey: 'lessons', tier: 2, at: 10 },
    { badgeKey: 'classes', tier: 1, at: 1 },
  ]);
  assert.deepEqual(tiersDue(stats({}), []), []);
});

test('standings say how far to the next tier', () => {
  const s = standings(stats({ lessons: 30 }), [{ badgeKey: 'lessons', tier: 2, awardedAt: new Date('2026-09-01') }]);
  const lessons = s.find((x) => x.def.key === 'lessons')!;
  assert.equal(lessons.tier, 2);
  assert.equal(lessons.next, 50);
  assert.equal(lessons.percent, 50);
  const perfect = s.find((x) => x.def.key === 'perfect')!;
  assert.equal(perfect.tier, 0);
  assert.equal(perfect.next, 1);
  assert.equal(perfect.percent, 0);
});

test('a streak grows on consecutive days, holds on the same day, resets on a gap', () => {
  let s = { current: 0, longest: 0, lastActiveDay: null as string | null, recentDays: [] as string[] };
  s = touch(s, '2026-09-01');
  s = touch(s, '2026-09-01');
  s = touch(s, '2026-09-02');
  s = touch(s, '2026-09-03');
  assert.equal(s.current, 3);
  assert.equal(s.longest, 3);
  s = touch(s, '2026-09-06');
  assert.equal(s.current, 1);
  assert.equal(s.longest, 3);
  assert.deepEqual(s.recentDays, ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-06']);
});

test("yesterday's run is alive today, an older one has ended", () => {
  const s = { current: 4, longest: 4, lastActiveDay: '2026-09-12', recentDays: [] };
  assert.equal(currentStreak(s, '2026-09-12'), 4);
  assert.equal(currentStreak(s, '2026-09-13'), 4);
  assert.equal(atRisk(s, '2026-09-13'), true);
  assert.equal(currentStreak(s, '2026-09-14'), 0);
  assert.equal(streakLine(s, '2026-09-13'), '4 days in a row. Do something today to keep it.');
  assert.equal(streakLine(s, '2026-09-20'), 'No streak right now. Your longest was 4 days.');
});
