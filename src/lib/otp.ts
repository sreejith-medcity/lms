import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { db } from '@/lib/db';

/**
 * One-time codes.
 *
 * Four rules, all of them about the same thing: a six digit code is only worth
 * anything if guessing it is hard.
 *
 * The code is hashed before it is stored, so a database read does not hand over
 * live codes. It is compared in constant time. Attempts are counted on the row
 * and five wrong guesses burn it, because a hundred guesses at a six digit code
 * is a one in ten thousand chance and a patient attacker has more than a
 * hundred. And a fresh request invalidates the previous code rather than adding
 * a second valid one, since two live codes is twice the guessing surface.
 *
 * Generated with randomInt rather than Math.random, which is not a security
 * decision so much as the absence of a mistake.
 */

const CODE_LENGTH = 6;
const TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
/** Stops somebody using the send button as a way to bill the academy. */
const RESEND_SECONDS = 60;

export type Purpose = 'signup' | 'login' | 'reset' | 'secondary_validation';

function hash(code: string, target: string): string {
  const pepper = process.env.AUTH_SECRET ?? 'insecure-development-secret';
  return createHash('sha256').update(`${pepper}:${target}:${code}`).digest('hex');
}

function generate(): string {
  return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0');
}

export interface Issued {
  code: string;
  expiresAt: Date;
  minutes: number;
}

export interface IssueResult {
  ok: boolean;
  issued?: Issued;
  /** Seconds still to wait, when a code was asked for too soon. */
  retryAfter?: number;
  error?: string;
}

export async function issueOtp(input: {
  target: string;
  channel: 'email' | 'sms' | 'whatsapp';
  purpose: Purpose;
  userId?: string | null;
}): Promise<IssueResult> {
  const recent = await db.otpToken.findFirst({
    where: { target: input.target, purpose: input.purpose, usedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });

  if (recent) {
    const age = (Date.now() - recent.createdAt.getTime()) / 1000;
    if (age < RESEND_SECONDS) {
      return { ok: false, retryAfter: Math.ceil(RESEND_SECONDS - age) };
    }
  }

  // Everything outstanding for this target and purpose is spent, so only the
  // new code works.
  await db.otpToken.updateMany({
    where: { target: input.target, purpose: input.purpose, usedAt: null },
    data: { usedAt: new Date() },
  });

  const code = generate();
  const expiresAt = new Date(Date.now() + TTL_MINUTES * 60_000);

  await db.otpToken.create({
    data: {
      userId: input.userId ?? null,
      channel: input.channel,
      target: input.target,
      codeHash: hash(code, input.target),
      purpose: input.purpose,
      expiresAt,
    },
  });

  return { ok: true, issued: { code, expiresAt, minutes: TTL_MINUTES } };
}

export interface CheckResult {
  ok: boolean;
  userId?: string | null;
  error?: string;
}

export async function checkOtp(input: {
  target: string;
  purpose: Purpose;
  code: string;
}): Promise<CheckResult> {
  const token = await db.otpToken.findFirst({
    where: { target: input.target, purpose: input.purpose, usedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { id: true, codeHash: true, expiresAt: true, attempts: true, userId: true },
  });

  // The same sentence for no code, a wrong code and an expired code, so this
  // cannot be used to find out which addresses have an account.
  const wrong = { ok: false, error: 'That code is wrong or has expired. Ask for a new one.' };

  if (!token) return wrong;

  if (token.expiresAt.getTime() < Date.now()) {
    await db.otpToken.update({ where: { id: token.id }, data: { usedAt: new Date() } });
    return wrong;
  }

  if (token.attempts >= MAX_ATTEMPTS) {
    await db.otpToken.update({ where: { id: token.id }, data: { usedAt: new Date() } });
    return { ok: false, error: 'Too many wrong tries. Ask for a new code.' };
  }

  const expected = Buffer.from(token.codeHash, 'hex');
  const actual = Buffer.from(hash(input.code.trim(), input.target), 'hex');
  const matches = expected.length === actual.length && timingSafeEqual(expected, actual);

  if (!matches) {
    await db.otpToken.update({
      where: { id: token.id },
      data: { attempts: { increment: 1 } },
    });
    return wrong;
  }

  await db.otpToken.update({ where: { id: token.id }, data: { usedAt: new Date() } });
  return { ok: true, userId: token.userId };
}

/** Housekeeping, so the table does not grow forever. */
export async function purgeExpiredOtps(olderThanDays = 7): Promise<number> {
  const result = await db.otpToken.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - olderThanDays * 86_400_000) } },
  });
  return result.count;
}
