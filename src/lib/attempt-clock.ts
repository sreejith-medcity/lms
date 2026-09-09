/**
 * When an attempt runs out.
 *
 * Deliberately a plain module rather than part of the server actions file. It is
 * pure arithmetic over a start time the server already holds, and exporting it
 * from a 'use server' module would both break the build (every export there must
 * be async) and publish a network endpoint for something that never needed one.
 *
 * The single source of truth is the attempt's own startedAt plus the
 * assessment's duration. Nothing about the deadline is ever sent up from the
 * browser, so closing a laptop does not pause it and a wrong clock does not
 * extend it.
 */

export interface AttemptDeadline {
  startedAt: Date;
  endsAt: Date | null;
  secondsLeft: number | null;
  expired: boolean;
}

export function deadlineFor(startedAt: Date, durationMinutes: number | null): AttemptDeadline {
  if (!durationMinutes) {
    return { startedAt, endsAt: null, secondsLeft: null, expired: false };
  }

  const endsAt = new Date(startedAt.getTime() + durationMinutes * 60_000);
  const secondsLeft = Math.floor((endsAt.getTime() - Date.now()) / 1000);
  return { startedAt, endsAt, secondsLeft, expired: secondsLeft <= 0 };
}
