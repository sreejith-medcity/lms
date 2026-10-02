import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * The classes feed HRSuite reads to pay online tutors.
 *
 * HRSuite asks for a window of classes with the shared secret as a bearer
 * token; this answers with each class, who taught it, whether it was held,
 * how many learners came and, where the class platform said so, the tutor's
 * own time in it. Read-only: nothing here changes a class.
 *
 * A class with an online tutor says so (`tutoring`), and is one to one when
 * its group seats one learner, so pay rules that differ by format have the
 * fact rather than a guess from the head count.
 */

export const HRSUITE_MAX_WINDOW_DAYS = 62;

/** The bearer token matches the secret, compared in constant time. */
export function bearerMatches(header: string | null, secret: string | null | undefined): boolean {
  if (!secret || !header) return false;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!m) return false;
  const a = createHash('sha256').update(m[1].trim()).digest();
  const b = createHash('sha256').update(secret).digest();
  return timingSafeEqual(a, b);
}

/** The window asked for, or why it cannot be served. */
export function parseWindow(fromRaw: string | null, toRaw: string | null): { ok: true; from: Date; to: Date } | { ok: false; error: string } {
  const from = fromRaw ? new Date(fromRaw) : null;
  const to = toRaw ? new Date(toRaw) : null;
  if (!from || Number.isNaN(from.getTime()) || !to || Number.isNaN(to.getTime())) return { ok: false, error: 'Give from and to as ISO dates.' };
  if (to <= from) return { ok: false, error: 'to must be after from.' };
  if ((to.getTime() - from.getTime()) / 864e5 > HRSUITE_MAX_WINDOW_DAYS) return { ok: false, error: `At most ${HRSUITE_MAX_WINDOW_DAYS} days at a time.` };
  return { ok: true, from, to };
}

export type FeedInstructor = { userId: string; employeeCode: string | null; email: string | null; name: string | null; phone: string | null; isPrimary: boolean; joinedAt: string | null; leftAt: string | null; minutesPresent: number | null };

export type FeedSession = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  status: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  oneToOne: boolean;
  /** A class of an online tutor's own learners (Online tutors here), not of an ordinary batch. */
  tutoring: boolean;
  batch: { id: string; name: string; mode: string | null; level: string | null } | null;
  course: string | null;
  provider: string | null;
  registerSubmitted: boolean;
  learnersExpected: number | null;
  learnersPresent: number | null;
  hasRecording: boolean;
  instructors: FeedInstructor[];
};

/** Minutes a tutor was in the class, from their own attendance row where there is one. */
export function instructorMinutes(row: { joinedAt: Date | null; leftAt: Date | null; minutesPresent: number } | undefined): number | null {
  if (!row) return null;
  if (row.minutesPresent > 0) return row.minutesPresent;
  if (row.joinedAt && row.leftAt && row.leftAt > row.joinedAt) return Math.round((row.leftAt.getTime() - row.joinedAt.getTime()) / 60000);
  return null;
}

/** One learner by design: a class booked for one person, or an online tutor's group of one. */
export function isOneToOne(session: { learnerId: string | null }, tutoringCapacity: number | undefined): boolean {
  return Boolean(session.learnerId) || tutoringCapacity === 1;
}
