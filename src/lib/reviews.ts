/**
 * Course reviews: the rules with no database in them.
 *
 * A review is a testimonial left by a learner about the course they are on.
 * It is asked for once they are far enough in to have an opinion worth
 * reading (a threshold the academy sets), it can go live on arrival or wait
 * for a look, and the academy can answer it in public.
 */

export const REVIEW_MIN_CHARS = 10;
export const REVIEW_MAX_CHARS = 1200;
export const REPLY_MAX_CHARS = 1000;

export type PublishMode = 'REVIEW' | 'FOUR_UP' | 'ALL';

export const PUBLISH_MODES: { value: PublishMode; label: string }[] = [
  { value: 'REVIEW', label: 'Every review waits for the team to read it' },
  { value: 'FOUR_UP', label: 'Four and five stars go live at once; the rest wait' },
  { value: 'ALL', label: 'Every review goes live at once' },
];

/** Is this learner far enough in to be asked? */
export function canReview(progressPercent: number, threshold: number): boolean {
  return progressPercent >= Math.max(0, Math.min(100, threshold));
}

/** Does a review of this rating go live the moment it arrives? */
export function publishOnArrival(mode: string, rating: number): boolean {
  if (mode === 'ALL') return true;
  if (mode === 'FOUR_UP') return rating >= 4;
  return false;
}

export function reviewProblem(rating: number, comment: string): string | null {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return 'Pick a rating first.';
  const clean = comment.trim();
  if (clean.length < REVIEW_MIN_CHARS) return 'Tell us a little more than that.';
  if (clean.length > REVIEW_MAX_CHARS) return `Keep it under ${REVIEW_MAX_CHARS} characters.`;
  return null;
}

export function replyProblem(reply: string): string | null {
  const clean = reply.trim();
  if (clean.length > REPLY_MAX_CHARS) return `Keep the reply under ${REPLY_MAX_CHARS} characters.`;
  return null;
}

export interface RatingBar {
  stars: 5 | 4 | 3 | 2 | 1;
  count: number;
  /** Of all reviews, 0 to 100. */
  percent: number;
}

export interface ReviewSummary {
  count: number;
  /** One decimal place; 0 when there are none. */
  average: number;
  bars: RatingBar[];
  /** Four stars and up, as a share of the whole; what "would recommend" means here. */
  recommendPercent: number;
}

/**
 * The block at the top of the reviews: average, count, the five bars.
 * Takes (rating, count) pairs so it works from a groupBy as well as a list.
 */
export function reviewSummary(counts: { rating: number; count: number }[]): ReviewSummary {
  const tally = new Map<number, number>();
  let total = 0;
  let sum = 0;
  for (const { rating, count } of counts) {
    const star = Math.min(5, Math.max(1, Math.round(rating)));
    tally.set(star, (tally.get(star) ?? 0) + count);
    total += count;
    sum += rating * count;
  }
  const bars = ([5, 4, 3, 2, 1] as const).map((stars) => {
    const count = tally.get(stars) ?? 0;
    return { stars, count, percent: total ? Math.round((count / total) * 100) : 0 };
  });
  const fourUp = (tally.get(5) ?? 0) + (tally.get(4) ?? 0);
  return {
    count: total,
    average: total ? Math.round((sum / total) * 10) / 10 : 0,
    bars,
    recommendPercent: total ? Math.round((fourUp / total) * 100) : 0,
  };
}

/** The line that asks: it should say why they are being asked now. */
export function inviteCopy(progressPercent: number, courseTitle: string): { title: string; body: string } {
  if (progressPercent >= 100) {
    return {
      title: `You finished ${courseTitle}`,
      body: 'Would you tell the next person what it was like?',
    };
  }
  return {
    title: `How is ${courseTitle} going?`,
    body: `You are ${Math.round(progressPercent)}% through. A few honest lines help the next person decide, and you can change them later.`,
  };
}

/** What a review card says about who wrote it. */
export function reviewerBadge(r: { userId: string | null; progressAtReview: number | null }): string | null {
  if (!r.userId) return null;
  if (r.progressAtReview != null && r.progressAtReview >= 100) return 'Completed the course';
  return 'Verified learner';
}
