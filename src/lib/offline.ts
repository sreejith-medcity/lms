/**
 * Which lessons a learner may keep on their phone, and for how long.
 *
 * A lesson goes offline only when the academy marked it downloadable, it is
 * a file (not a link, a page of text, an interactive package or a test), the
 * file is not DRM-protected, and it has opened for this learner (drip and
 * section visibility). What is on the phone is good for a week at a time:
 * the app asks again whenever it is online, and a lesson that is no longer
 * offered (the enrolment ended, the academy took the tick off) is deleted
 * from the phone at that check. Past the week with no check, the app stops
 * opening downloads until it has been online once.
 *
 * Pure: the database side is `lib/api/downloads.ts`.
 */

export const OFFLINE_LICENCE_DAYS = 7;

/** Files the app can keep: played in the app (video, audio) or opened with the phone's own viewer. */
export const OFFLINE_TYPES = ['VIDEO', 'AUDIO', 'PDF', 'IMAGE', 'DOC', 'SHEET', 'SLIDE', 'EPUB', 'ZIP'] as const;

export interface OfflineCandidate {
  type: string;
  isDownloadable: boolean;
  hasFile: boolean;
  drmProtected: boolean;
  locked: boolean;
}

export type OfflineVerdict = 'OFFERED' | 'NOT_DOWNLOADABLE' | 'NOT_A_FILE' | 'PROTECTED' | 'LOCKED';

export function offlineVerdict(c: OfflineCandidate): OfflineVerdict {
  if (!c.isDownloadable) return 'NOT_DOWNLOADABLE';
  if (!c.hasFile || !(OFFLINE_TYPES as readonly string[]).includes(c.type)) return 'NOT_A_FILE';
  if (c.drmProtected) return 'PROTECTED';
  if (c.locked) return 'LOCKED';
  return 'OFFERED';
}

/** When the phone must have checked in again by. */
export function licenceUntil(now: Date, days = OFFLINE_LICENCE_DAYS): Date {
  return new Date(now.getTime() + days * 86_400_000);
}

/** "12.4 MB" for a size in bytes. */
export function sizeLabel(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
