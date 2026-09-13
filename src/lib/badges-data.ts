import { db } from '@/lib/db';
import { dayKey } from '@/lib/clock';
import { queueNotifications } from '@/lib/notify';
import { settingBool, settingNumber } from '@/lib/settings/store';
import { badgeByKey, currentStreak, tierName, tiersDue, touch, type Stats, type StreakShape } from '@/lib/badges';

/**
 * The counting behind the badges, and the two hooks the rest of the app
 * calls: a day of learning happened, and something badge-worthy happened.
 * Both are best effort and never throw into the caller: a badge that
 * fails to award must not undo the lesson that earned it.
 */

const EMPTY: StreakShape = { current: 0, longest: 0, lastActiveDay: null, recentDays: [] };

export async function streakFor(organizationId: string, userId: string): Promise<StreakShape> {
  const row = await db.learnerStreak.findUnique({ where: { organizationId_userId: { organizationId, userId } }, select: { current: true, longest: true, lastActiveDay: true, recentDays: true } });
  return row ?? EMPTY;
}

export async function learnerStats(organizationId: string, userId: string, timeZone: string, now = new Date()): Promise<Stats> {
  const [lessons, classes, earlyBird, courses, perfect, homeworkOnTime, questions, reviews, streak] = await Promise.all([
    db.materialProgress.count({ where: { userId, completedAt: { not: null }, enrollment: { organizationId } } }),
    db.attendance.count({ where: { userId, status: { in: ['PRESENT', 'LATE'] }, session: { organizationId } } }),
    db.attendance.count({ where: { userId, status: 'PRESENT', wasInTime: true, session: { organizationId } } }),
    db.enrollment.count({ where: { organizationId, userId, status: 'COMPLETED' } }),
    db.attempt.count({ where: { userId, status: 'EVALUATED', scorePercent: { gte: 100 }, assessment: { organizationId } } }),
    db.assignmentSubmission.count({ where: { organizationId, userId, isLate: false, status: { in: ['SUBMITTED', 'GRADED'] } } }),
    db.lessonQuestion.count({ where: { organizationId, userId } }),
    db.testimonial.count({ where: { organizationId, userId } }),
    streakFor(organizationId, userId),
  ]);
  return { lessons, classes, earlyBird, courses, perfect, homeworkOnTime, questions, reviews, streak: currentStreak(streak, dayKey(now, timeZone)) };
}

/** Award whatever the learner's counts have earned and not yet received. */
export async function awardDueBadges(organizationId: string, userId: string): Promise<number> {
  try {
    if (!(await settingBool(organizationId, 'learning.badges'))) return 0;
    const tenant = await db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true, name: true } });
    if (!tenant) return 0;
    const [stats, held, person] = await Promise.all([
      learnerStats(organizationId, userId, tenant.timezone),
      db.badgeAward.findMany({ where: { organizationId, userId }, select: { badgeKey: true, tier: true } }),
      db.user.findFirst({ where: { id: userId, organizationId }, select: { id: true, name: true, email: true, phone: true } }),
    ]);
    if (!person) return 0;
    const due = tiersDue(stats, held);
    if (due.length === 0) return 0;

    const pointsPerBadge = await settingNumber(organizationId, 'learning.badgePoints');
    for (const d of due) {
      const def = badgeByKey(d.badgeKey);
      if (!def) continue;
      const context = `${d.at} ${def.unit}`;
      await db.badgeAward.upsert({
        where: { organizationId_userId_badgeKey_tier: { organizationId, userId, badgeKey: d.badgeKey, tier: d.tier } },
        create: { organizationId, userId, badgeKey: d.badgeKey, tier: d.tier, context },
        update: {},
      });
      if (pointsPerBadge > 0) {
        const { credit } = await import('@/lib/wallet');
        await credit({ userId, points: pointsPerBadge * d.tier, reason: 'BADGE', note: `${def.name}, ${tierName(d.tier)}` }).catch(() => null);
      }
      await queueNotifications({
        organizationId,
        eventKey: 'badge.earned',
        channels: ['IN_APP', 'PUSH'],
        recipients: [{ userId: person.id, email: person.email, phone: person.phone }],
        dedupeKey: `badge:${d.badgeKey}:${d.tier}`,
        context: { name: person.name, badge: `${def.emoji} ${def.name}`, tier: tierName(d.tier), how: context, organization: tenant.name, url: '/learn/badges' },
      }).catch(() => null);
    }
    return due.length;
  } catch (err) {
    console.error('[badges] award', err instanceof Error ? err.message : err);
    return 0;
  }
}

/**
 * A day with learning in it. Cheap when nothing changes: the streak row is
 * read and left alone if today is already counted.
 */
export async function recordLearningDay(organizationId: string, userId: string, now = new Date()): Promise<void> {
  try {
    const tenant = await db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
    if (!tenant) return;
    const today = dayKey(now, tenant.timezone);
    const before = await streakFor(organizationId, userId);
    if (before.lastActiveDay === today) return;
    const after = touch(before, today);
    await db.learnerStreak.upsert({
      where: { organizationId_userId: { organizationId, userId } },
      create: { organizationId, userId, ...after },
      update: after,
    });
    // A streak tier may have just been reached.
    if ([3, 7, 30, 100].includes(after.current)) await awardDueBadges(organizationId, userId);
  } catch (err) {
    console.error('[badges] streak', err instanceof Error ? err.message : err);
  }
}

/** Both hooks at once, for the moments that are a day of learning and badge-worthy. */
export async function afterLearning(organizationId: string, userId: string): Promise<void> {
  await recordLearningDay(organizationId, userId);
  await awardDueBadges(organizationId, userId);
}
