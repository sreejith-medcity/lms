import { db } from '@/lib/db';
import { settingNumber } from '@/lib/settings/store';

/**
 * How many goes a learner has left with the AI examiner. Counted over the
 * last twenty-four hours rather than a calendar day, so midnight in
 * whichever timezone the server sits in does not hand out a fresh batch.
 */
export async function practiceAllowance(organizationId: string, userId: string): Promise<{ used: number; limit: number }> {
  const [limit, used] = await Promise.all([
    settingNumber(organizationId, 'ai.practicePerDay'),
    db.practiceAttempt.count({
      where: { organizationId, userId, createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } },
    }),
  ]);
  return { used, limit: Math.max(1, limit || 5) };
}

