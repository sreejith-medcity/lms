/**
 * Questions pinned to a lesson: the rules with no database in them.
 *
 * A question belongs to one lesson and is seen by the batch that asked it (or,
 * for a self-paced learner, by everyone on the course). The trainer answers it
 * once and everybody who had the same question is told. That is the whole
 * difference from the discussion room, where a thread belongs to nobody.
 */

export const QUESTION_MAX = 2000;
export const ANSWER_MAX = 6000;

export function questionProblem(body: string): string | null {
  const clean = body.trim();
  if (!clean) return 'Write the question first.';
  if (clean.length < 8) return 'Give the trainer a little more to go on.';
  if (clean.length > QUESTION_MAX) return `Keep it under ${QUESTION_MAX} characters.`;
  return null;
}

export function answerProblem(body: string): string | null {
  const clean = body.trim();
  if (!clean) return 'Write the answer first.';
  if (clean.length > ANSWER_MAX) return `Keep it under ${ANSWER_MAX} characters.`;
  return null;
}

export interface QuestionLike {
  id: string;
  userId: string;
  batchId: string | null;
  isPinned: boolean;
  isHidden: boolean;
  answeredAt: Date | null;
  alsoAsking: string[];
  createdAt: Date;
}

/**
 * The batches whose questions a learner sees: their own batch and the
 * course-wide ones (asked by self-paced learners, whose batchId is null).
 */
export function visibleBatches(batchId: string | null): (string | null)[] {
  return batchId ? [null, batchId] : [null];
}

/** Adds or removes a learner from "I have this question too". The asker never counts. */
export function toggleAlsoAsking(list: string[], userId: string, askerId: string): string[] {
  if (userId === askerId) return list;
  return list.includes(userId) ? list.filter((id) => id !== userId) : [...list, userId];
}

/** How many people want the answer: the asker plus everyone who joined in. */
export function askingCount(q: Pick<QuestionLike, 'alsoAsking'>): number {
  return 1 + q.alsoAsking.length;
}

/**
 * The learner's list: pinned first, then unanswered before answered so a fresh
 * question is not buried, newest first inside each group.
 */
export function learnerOrder<T extends QuestionLike>(questions: T[]): T[] {
  return [...questions].sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    const aAns = a.answeredAt ? 1 : 0;
    const bAns = b.answeredAt ? 1 : 0;
    if (aAns !== bAns) return aAns - bAns;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
}

/**
 * The trainer's queue: unanswered first, the ones most people are waiting on
 * ahead of the rest, then oldest first so nobody waits longest.
 */
export function queueOrder<T extends QuestionLike>(questions: T[]): T[] {
  return [...questions].sort((a, b) => {
    const aAns = a.answeredAt ? 1 : 0;
    const bAns = b.answeredAt ? 1 : 0;
    if (aAns !== bAns) return aAns - bAns;
    if (!a.answeredAt) {
      const diff = askingCount(b) - askingCount(a);
      if (diff !== 0) return diff;
      return a.createdAt.getTime() - b.createdAt.getTime();
    }
    return (b.answeredAt?.getTime() ?? 0) - (a.answeredAt?.getTime() ?? 0);
  });
}

/** May this learner remove the question? Their own, and only while it is unanswered. */
export function canWithdraw(q: Pick<QuestionLike, 'userId' | 'answeredAt'>, userId: string): boolean {
  return q.userId === userId && !q.answeredAt;
}

/** Everyone to tell when the answer lands: the asker and whoever joined in, once each. */
export function toTell(q: Pick<QuestionLike, 'userId' | 'alsoAsking'>): string[] {
  return Array.from(new Set([q.userId, ...q.alsoAsking]));
}

export function waitingLabel(count: number): string {
  if (count === 0) return 'Nothing waiting';
  return count === 1 ? '1 question waiting' : `${count} questions waiting`;
}
