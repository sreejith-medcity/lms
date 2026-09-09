import { db } from '@/lib/db';
import type { $Enums, Prisma } from '@prisma/client';

/**
 * The outbox.
 *
 * Queueing and sending are separate on purpose. This writes a row per intended
 * message with status QUEUED and returns; `drain.ts` picks the rows up, renders
 * them, calls a provider and moves them to SENT or FAILED. The hard parts of
 * messaging are deciding who gets what and not sending it twice, and both of
 * those are settled here, before any provider is involved.
 *
 * The alternative, wiring the send first and the record second, is how an
 * institute ends up unable to answer "did she get the reminder or not".
 *
 * Context is written onto the row rather than looked up at send time, so a
 * reminder queued on Monday still says the right thing after the class is
 * renamed on Tuesday.
 */

export interface Recipient {
  /**
   * Null for somebody who has no account yet, which is the ordinary case for a
   * sign-up code. The log row still exists and still says where it went; it
   * simply is not attached to a learner, because there is not one to attach to.
   */
  userId: string | null;
  email: string | null;
  phone: string | null;
}

export interface QueueRequest {
  organizationId: string;
  eventKey: string;
  recipients: Recipient[];
  /** Written on the row so the sender can render without going back to the tables. */
  context?: Record<string, string>;
  /** Skip anyone already queued or sent this event for this context key. */
  dedupeKey?: string;
  /** Per-recipient context, merged over the shared context. */
  contextFor?: (person: Recipient) => Record<string, string>;
  /** Hold the message until this time. A reminder is not sent when it is written. */
  sendAt?: Date;
  /**
   * Force the channels, ignoring the academy's per-event settings.
   *
   * Only for messages where the channel is not a preference but a fact. A
   * sign-in code sent to a mobile number has to go by SMS: honouring a setting
   * that says "email only" would queue it against an address the caller never
   * gave, find nothing to send to, and report that the code went out.
   */
  channels?: $Enums.Channel[];
}

const DEFAULT_CHANNELS: $Enums.Channel[] = ['EMAIL'];

/**
 * Which channels this academy has switched on for this event. Absent settings
 * mean email only, which is the one channel that costs nothing to be wrong about.
 */
async function channelsFor(organizationId: string, eventKey: string): Promise<$Enums.Channel[]> {
  const setting = await db.notificationSetting.findFirst({
    where: { organizationId, eventKey, productId: null },
    select: { emailEnabled: true, smsEnabled: true, whatsappEnabled: true, pushEnabled: true },
  });
  if (!setting) return DEFAULT_CHANNELS;

  const channels: $Enums.Channel[] = [];
  if (setting.emailEnabled) channels.push('EMAIL');
  if (setting.smsEnabled) channels.push('SMS');
  if (setting.whatsappEnabled) channels.push('WHATSAPP');
  if (setting.pushEnabled) channels.push('PUSH');
  return channels.length ? channels : DEFAULT_CHANNELS;
}

function targetFor(channel: $Enums.Channel, person: Recipient): string | null {
  if (channel === 'EMAIL') return person.email;
  if (channel === 'SMS' || channel === 'WHATSAPP') return person.phone;
  return person.userId; // PUSH and IN_APP are addressed by account.
}

export interface QueueResult {
  queued: number;
  skipped: number;
  unreachable: number;
}

export async function queueNotifications(request: QueueRequest): Promise<QueueResult> {
  const channels = request.channels?.length
    ? request.channels
    : await channelsFor(request.organizationId, request.eventKey);
  const dedupe = request.dedupeKey ?? null;

  // One query, not one per person: a batch of forty absentees should not be
  // forty round trips before a single row is written.
  const already = dedupe
    ? new Set(
        (
          await db.notificationLog.findMany({
            where: {
              organizationId: request.organizationId,
              eventKey: request.eventKey,
              userId: {
                in: request.recipients
                  .map((r) => r.userId)
                  .filter((id): id is string => Boolean(id)),
              },
              status: { in: ['QUEUED', 'SENT', 'DELIVERED', 'READ'] },
              dedupeKey: dedupe,
            },
            select: { userId: true, channel: true },
          })
        ).map((row) => `${row.userId}:${row.channel}`),
      )
    : new Set<string>();

  const rows: {
    organizationId: string;
    userId: string | null;
    channel: $Enums.Channel;
    eventKey: string;
    target: string;
    status: string;
    dedupeKey: string | null;
    context: Prisma.InputJsonValue;
    nextAttemptAt: Date;
  }[] = [];

  let skipped = 0;
  let unreachable = 0;

  for (const person of request.recipients) {
    for (const channel of channels) {
      // Nobody without an account can be deduplicated against, because there is
      // no id to match on. That is correct: a stranger asking for a second code
      // should get one, and `issueOtp` is what rate limits them.
      if (person.userId && already.has(`${person.userId}:${channel}`)) {
        skipped += 1;
        continue;
      }
      const target = targetFor(channel, person);
      if (!target) {
        unreachable += 1;
        continue;
      }
      rows.push({
        organizationId: request.organizationId,
        userId: person.userId,
        channel,
        eventKey: request.eventKey,
        target,
        status: 'QUEUED',
        dedupeKey: dedupe,
        context: {
          ...(request.context ?? {}),
          ...(request.contextFor?.(person) ?? {}),
        } as Prisma.InputJsonValue,
        // Due immediately unless the caller said otherwise. A class reminder is
        // decided now and sent an hour before the class.
        nextAttemptAt: request.sendAt ?? new Date(),
      });
    }
  }

  // tenant-safe: every row was built above with the organisation this queue
  // request named, so there is nothing here that could belong to another one.
  if (rows.length) await db.notificationLog.createMany({ data: rows, skipDuplicates: true });

  return { queued: rows.length, skipped, unreachable };
}

/** Plain English for the person who pressed the button. */
export function describeQueue(result: QueueResult, noun = 'message'): string {
  if (result.queued === 0 && result.skipped > 0) {
    return 'They have all been told already, so nothing was queued again.';
  }
  if (result.queued === 0) {
    return 'Nobody could be reached: none of them have an email address or phone number on file.';
  }
  const parts = [
    `${result.queued} ${result.queued === 1 ? noun : `${noun}s`} queued`,
  ];
  if (result.skipped > 0) parts.push(`${result.skipped} already sent`);
  if (result.unreachable > 0) parts.push(`${result.unreachable} with no contact details`);
  return `${parts.join(', ')}. They go out on the next send, or when a provider is connected if none is yet.`;
}
