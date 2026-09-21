import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The member card: one identity a learner can present at the counter.
 *
 * The card is a QR (and the registration number under it for the branch
 * with no scanner). The QR carries the learner's id and a signature over
 * it, so a code has to have been made here to be read here: a photo of
 * somebody else's card is still that somebody, and a made-up one reads
 * as nothing. No table, no column: the signature is the record, and
 * rotating AUTH_SECRET retires every card at once, which is the right
 * behaviour for the one event that would call for it.
 */

const PREFIX = 'MC1';

function key(): Buffer {
  return createHmac('sha256', process.env.AUTH_SECRET || 'insecure-development-secret').update('member-card').digest();
}

function sign(userId: string): string {
  return createHmac('sha256', key()).update(userId).digest('base64url').slice(0, 16);
}

/** The text inside the QR. */
export function memberCode(userId: string): string {
  return `${PREFIX}.${userId}.${sign(userId)}`;
}

/**
 * What a scanned or typed code refers to: a signed card gives the user id;
 * a plain number is a registration number to look up; anything else is
 * nothing. The registration number route exists for the counter that has
 * a keyboard and no camera.
 */
export function readMemberCode(raw: string): { kind: 'user'; userId: string } | { kind: 'registration'; registrationNo: number } | null {
  const text = raw.trim();
  if (!text) return null;
  if (/^\d{1,9}$/.test(text)) return { kind: 'registration', registrationNo: Number(text) };
  const parts = text.split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) return null;
  const [, userId, given] = parts;
  if (!/^[a-z0-9]{10,40}$/i.test(userId) || !given) return null;
  const expected = Buffer.from(sign(userId));
  const actual = Buffer.from(given);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  return { kind: 'user', userId };
}
