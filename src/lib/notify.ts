import { db } from '@/lib/db';
import type { $Enums } from '@prisma/client';

/**
 * The outbox.
 *
 * No provider is connected yet, so nothing here sends anything: it writes a row
 * per intended message with status QUEUED. That is deliberate rather than a
 * placeholder. The hard parts of messaging are deciding who gets what and not
 * sending it twice, and both of those are decided here; when a provider arrives
 * in Phase 7 it drains this table and moves rows to SENT.
 *
 * The alternative — wiring the send first and the record second — is how an
 * institute ends up unable to answer "did she get the reminder or not".
 */

export interface Recipient {
  userId: string;
  email: string | null;
  phone: string | null;
}

export interface QueueRequest {
  organizationId: string;
  eventKey: string;
  recipients: Recipient[];
  /** Written on the row so a later provider knows what to render. */
  context?: Record<string, string>;
  /** Skip anyone already queued or sent this event for this context key. */
  dedupeKey?: string;
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
  const channels = await channelsFor(request.organizationId, request.eventKey);
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
              userId: { in: request.recipients.map((r) => r.userId) },
              status: { in: ['QUEUED', 'SENT', 'DELIVERED', 'READ'] },
              provider: dedupe,
            },
            select: { userId: true, channel: true },
          })
        ).map((row) => `${row.userId}:${row.channel}`),
      )
    : new Set<string>();

  const rows: {
    organizationId: string;
    userId: string;
    channel: $Enums.Channel;
    eventKey: string;
    target: string;
    status: string;
    provider: string | null;
    error: string | null;
  }[] = [];

  let skipped = 0;
  let unreachable = 0;

  for (const person of request.recipients) {
    for (const channel of channels) {
      if (already.has(`${person.userId}:${channel}`)) {
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
        // provider carries the dedupe key until a real provider claims the row.
        provider: dedupe,
        error: null,
      });
    }
  }

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
  return `${parts.join(', ')}. They go out when a messaging provider is connected.`;
}
