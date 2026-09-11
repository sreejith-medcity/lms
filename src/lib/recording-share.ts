/**
 * Whether a shared recording may be played.
 *
 * The office shares a class with one candidate: somebody who missed it,
 * somebody being shown what a course is like before they pay. What they must
 * not have is a URL that works forever and works for everyone it is
 * forwarded to, which is what a plain unguessable link is.
 *
 * So a share names a learner and a date, and both are checked every time the
 * page is opened rather than only when the link is made. The rules live here,
 * away from the database, because they are the part worth being sure about:
 * an expiry that is checked in one place and forgotten in another is how a
 * recording stays open for a month.
 */

export type ShareVerdict =
  | { ok: true; viewsLeft: number | null }
  | { ok: false; reason: ShareRefusal; message: string };

export type ShareRefusal = 'REVOKED' | 'EXPIRED' | 'NOT_YET' | 'EXHAUSTED' | 'WRONG_LEARNER' | 'SIGN_IN';

export interface ShareRecord {
  userId: string;
  expiresAt: Date;
  /** Null means the date is the only limit. */
  maxViews: number | null;
  viewCount: number;
  revokedAt: Date | null;
  createdAt: Date;
}

const MESSAGES: Record<ShareRefusal, string> = {
  REVOKED: 'This link has been withdrawn by the academy.',
  EXPIRED: 'This link has expired. Ask the academy for another one.',
  NOT_YET: 'This link is not open yet.',
  EXHAUSTED: 'This link has been used the number of times it allowed.',
  WRONG_LEARNER: 'This link was shared with a different account. Sign in as that learner to watch it.',
  SIGN_IN: 'Please sign in to watch this recording.',
};

export function shareVerdict(
  share: ShareRecord,
  viewerId: string | null,
  now: Date = new Date(),
): ShareVerdict {
  const refuse = (reason: ShareRefusal): ShareVerdict => ({
    ok: false,
    reason,
    message: MESSAGES[reason],
  });

  if (share.revokedAt) return refuse('REVOKED');
  if (share.createdAt > now) return refuse('NOT_YET');
  if (share.expiresAt <= now) return refuse('EXPIRED');

  // Who is asking is checked before how many views are left, so somebody
  // holding a forwarded link is told it is not theirs rather than being told
  // it is used up, which would be a lie and a hint.
  if (!viewerId) return refuse('SIGN_IN');
  if (viewerId !== share.userId) return refuse('WRONG_LEARNER');

  if (share.maxViews != null && share.viewCount >= share.maxViews) return refuse('EXHAUSTED');

  return {
    ok: true,
    viewsLeft: share.maxViews == null ? null : Math.max(0, share.maxViews - share.viewCount),
  };
}

/**
 * The expiry from a number of days, which is how the office thinks about it:
 * "give them two days". The end of the second day, not this time in two
 * days, because a link handed over at nine in the evening should not die at
 * nine in the evening.
 */
export function expiryFromDays(days: number, from: Date = new Date()): Date {
  const whole = Math.max(1, Math.min(365, Math.floor(days)));
  const end = new Date(from);
  end.setDate(end.getDate() + whole);
  end.setHours(23, 59, 59, 999);
  return end;
}

/** How long is left, for the admin list and for the learner's own page. */
export function describeRemaining(expiresAt: Date, now: Date = new Date()): string {
  const ms = expiresAt.getTime() - now.getTime();
  if (ms <= 0) return 'expired';

  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return 'less than an hour left';
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} left`;

  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} left`;
}
