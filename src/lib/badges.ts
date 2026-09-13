import { addDays } from '@/lib/clock';

/**
 * Badges, streaks and milestones.
 *
 * Points already exist (the wallet). This is the other half: the small,
 * legible rewards that a learner can see without arithmetic. Every badge
 * is a count against a tier, so "how far to the next one" is always a
 * number, and the catalogue is code rather than configuration because a
 * badge nobody can explain is a badge nobody trusts.
 */

export interface BadgeDef {
  key: string;
  name: string;
  /** What the count is of, in a phrase that fits "3 of 10 {unit}". */
  unit: string;
  /** How it is earned, in one line. */
  how: string;
  /** Counts at which each tier is awarded, ascending. */
  tiers: number[];
  /** The stat it reads. */
  stat: StatKey;
  emoji: string;
}

export type StatKey = 'lessons' | 'classes' | 'streak' | 'courses' | 'perfect' | 'homeworkOnTime' | 'questions' | 'reviews' | 'earlyBird';

export const BADGES: BadgeDef[] = [
  { key: 'lessons', name: 'Lesson by lesson', unit: 'lessons finished', how: 'Finish lessons.', tiers: [1, 10, 50, 150], stat: 'lessons', emoji: '📗' },
  { key: 'classes', name: 'In the room', unit: 'classes attended', how: 'Be there for live classes.', tiers: [1, 10, 30, 75], stat: 'classes', emoji: '🎓' },
  { key: 'streak', name: 'On a roll', unit: 'days in a row', how: 'Learn something every day, on the academy clock.', tiers: [3, 7, 30, 100], stat: 'streak', emoji: '🔥' },
  { key: 'courses', name: 'Finisher', unit: 'courses completed', how: 'Complete a course.', tiers: [1, 3, 5], stat: 'courses', emoji: '🏁' },
  { key: 'perfect', name: 'Full marks', unit: 'perfect scores', how: 'Score 100% on a test.', tiers: [1, 5], stat: 'perfect', emoji: '💯' },
  { key: 'homework', name: 'Handed in', unit: 'assignments on time', how: 'Hand homework in before it is due.', tiers: [1, 5, 20], stat: 'homeworkOnTime', emoji: '📝' },
  { key: 'curious', name: 'Curious', unit: 'questions asked', how: 'Ask a question on a lesson.', tiers: [1, 10], stat: 'questions', emoji: '💬' },
  { key: 'earlyBird', name: 'Early bird', unit: 'classes joined on time', how: 'Join a class before it starts.', tiers: [5, 25], stat: 'earlyBird', emoji: '🌅' },
];

export type Stats = Record<StatKey, number>;

export function badgeByKey(key: string): BadgeDef | undefined {
  return BADGES.find((b) => b.key === key);
}

/** The tiers a set of stats earns that are not yet held. */
export function tiersDue(stats: Stats, held: { badgeKey: string; tier: number }[]): { badgeKey: string; tier: number; at: number }[] {
  const out: { badgeKey: string; tier: number; at: number }[] = [];
  for (const b of BADGES) {
    const value = stats[b.stat] ?? 0;
    b.tiers.forEach((at, i) => {
      const tier = i + 1;
      if (value >= at && !held.some((h) => h.badgeKey === b.key && h.tier === tier)) out.push({ badgeKey: b.key, tier, at });
    });
  }
  return out;
}

export interface BadgeStanding {
  def: BadgeDef;
  /** Highest tier held, 0 for none. */
  tier: number;
  value: number;
  /** The next tier's threshold, or null when every tier is held. */
  next: number | null;
  /** 0 to 100 towards the next tier. */
  percent: number;
  awardedAt: Date | null;
}

/** Where a learner stands on every badge, for the page. */
export function standings(stats: Stats, held: { badgeKey: string; tier: number; awardedAt: Date }[]): BadgeStanding[] {
  return BADGES.map((def) => {
    const mine = held.filter((h) => h.badgeKey === def.key).sort((a, b) => b.tier - a.tier);
    const tier = mine[0]?.tier ?? 0;
    const value = stats[def.stat] ?? 0;
    const next = def.tiers[tier] ?? null;
    const prev = tier > 0 ? def.tiers[tier - 1] : 0;
    const percent = next === null ? 100 : Math.max(0, Math.min(100, Math.round(((value - prev) / (next - prev)) * 100)));
    return { def, tier, value, next, percent, awardedAt: mine[0]?.awardedAt ?? null };
  });
}

export function tierName(tier: number): string {
  return ['', 'Bronze', 'Silver', 'Gold', 'Platinum'][tier] ?? `Tier ${tier}`;
}

/* Streaks ------------------------------------------------------------------ */

export interface StreakShape {
  current: number;
  longest: number;
  lastActiveDay: string | null;
  recentDays: string[];
}

/**
 * Record a day of learning. Same day: nothing changes. The day after:
 * one more. Any gap: back to one. The list of recent days is kept for the
 * calendar and capped so it never grows without bound.
 */
export function touch(s: StreakShape, dayKey: string): StreakShape {
  if (s.lastActiveDay === dayKey) return s;
  const consecutive = s.lastActiveDay !== null && addDays(s.lastActiveDay, 1) === dayKey;
  const current = consecutive ? s.current + 1 : 1;
  const recentDays = [...s.recentDays.filter((d) => d !== dayKey), dayKey].slice(-60);
  return { current, longest: Math.max(s.longest, current), lastActiveDay: dayKey, recentDays };
}

/** The streak as it stands today: yesterday's run is still alive, an older one has ended. */
export function currentStreak(s: StreakShape, todayKey: string): number {
  if (!s.lastActiveDay) return 0;
  if (s.lastActiveDay === todayKey || addDays(s.lastActiveDay, 1) === todayKey) return s.current;
  return 0;
}

/** Whether today still needs something done to keep the run going. */
export function atRisk(s: StreakShape, todayKey: string): boolean {
  return currentStreak(s, todayKey) > 0 && s.lastActiveDay !== todayKey;
}

export function streakLine(s: StreakShape, todayKey: string): string {
  const n = currentStreak(s, todayKey);
  if (n === 0) return s.longest > 0 ? `No streak right now. Your longest was ${s.longest} days.` : 'Learn something today to start a streak.';
  if (atRisk(s, todayKey)) return `${n} day${n === 1 ? '' : 's'} in a row. Do something today to keep it.`;
  return `${n} day${n === 1 ? '' : 's'} in a row.`;
}
