import { db } from '@/lib/db';
import { issueOtp, type Purpose } from '@/lib/otp';
import { queueNotifications } from '@/lib/notify';
import { drain } from '@/lib/messaging/drain';

/**
 * Getting a code to somebody, now.
 *
 * The outbox is drained on a schedule, which is right for a class reminder and
 * useless for a sign-in code: nobody waits five minutes staring at a form. So
 * this queues the message the ordinary way, keeping the record and the channel
 * settings, and then immediately drains the rows it just wrote.
 *
 * The code itself is never returned to the caller, and never written into the
 * response. It exists in two places: the message, and a hash in the database.
 */

export interface DeliveryResult {
  ok: boolean;
  /** Where it went, masked, so the screen can say "sent to the number ending 4471". */
  sentTo?: string;
  retryAfter?: number;
  error?: string;
}

function mask(target: string): string {
  if (target.includes('@')) {
    const [name, domain] = target.split('@');
    return `${name.slice(0, 2)}${'*'.repeat(Math.max(1, name.length - 2))}@${domain}`;
  }
  return `the number ending ${target.slice(-4)}`;
}

export async function sendOtp(input: {
  organizationId: string;
  target: string;
  purpose: Purpose;
  userId?: string | null;
  /** Set when the code is a second factor rather than the sign-in itself. */
  eventKey?: string;
}): Promise<DeliveryResult> {
  const isEmail = input.target.includes('@');
  const channel = isEmail ? 'email' : 'sms';

  const issued = await issueOtp({
    target: input.target,
    channel,
    purpose: input.purpose,
    userId: input.userId,
  });

  if (!issued.ok || !issued.issued) {
    return {
      ok: false,
      retryAfter: issued.retryAfter,
      error: issued.retryAfter
        ? `A code was already sent. You can ask for another in ${issued.retryAfter} seconds.`
        : 'Could not send a code just now.',
    };
  }

  const organization = await db.organization.findUnique({
    where: { id: input.organizationId },
    select: { name: true },
  });

  await queueNotifications({
    organizationId: input.organizationId,
    eventKey: input.eventKey ?? 'account.otp',
    recipients: [
      {
        // Null where there is no account yet, which is the ordinary case for a
        // sign-up code. The log row still records where it went.
        userId: input.userId ?? null,
        email: isEmail ? input.target : null,
        phone: isEmail ? null : input.target,
      },
    ],
    // The channel is decided by what the person typed, not by a setting. They
    // gave a mobile number, so the code goes to that number.
    channels: [isEmail ? 'EMAIL' : 'SMS'],
    context: {
      code: issued.issued.code,
      minutes: String(issued.issued.minutes),
      organization: organization?.name ?? 'your academy',
    },
  });

  // Straight out, rather than on the next scheduled run.
  const result = await drain(input.organizationId, 5);

  if (result.sent === 0) {
    return {
      ok: false,
      error:
        result.blocked[0] ??
        'The code could not be sent. No messaging provider is connected for that channel.',
    };
  }

  return { ok: true, sentTo: mask(input.target) };
}
