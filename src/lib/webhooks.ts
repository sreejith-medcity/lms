import { createHmac } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';

/**
 * Telling other systems what happened here.
 *
 * The generic escape hatch: an academy that wants its enrolments in a
 * spreadsheet, its leads in a CRM we have not written a connector for, or a
 * Slack message when a refund goes through, points a URL at us and gets a
 * signed POST.
 *
 * Signed, because an unauthenticated POST claiming a payment succeeded is a way
 * into whatever receives it. Timestamped, so a captured delivery cannot be
 * replayed a month later. Recorded, because "we never got it" is the first thing
 * anyone says and the delivery log is the only way to settle it.
 */

const MAX_ATTEMPTS = 5;
const BACKOFF_MINUTES = [0, 1, 5, 30, 180];

export function sign(secret: string, timestamp: string, body: string): string {
  return `v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

/**
 * Queue a delivery for every hook subscribed to this event. Queued rather than
 * sent inline: a slow endpoint on somebody else's server must not make enrolling
 * slow here.
 */
export async function emit(
  organizationId: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<number> {
  const hooks = await db.webhook.findMany({
    where: { organizationId, isActive: true, events: { has: event } },
    select: { id: true },
  });
  if (!hooks.length) return 0;

  await db.webhookDelivery.createMany({
    data: hooks.map((hook) => ({
      webhookId: hook.id,
      event,
      payload: {
        event,
        sentAt: new Date().toISOString(),
        data: payload,
      } as unknown as Prisma.InputJsonValue,
    })),
  });

  return hooks.length;
}

export interface DispatchResult {
  attempted: number;
  delivered: number;
  failed: number;
}

export async function dispatchWebhooks(limit = 50): Promise<DispatchResult> {
  const result: DispatchResult = { attempted: 0, delivered: 0, failed: 0 };

  const pending = await db.webhookDelivery.findMany({
    where: { deliveredAt: null, attempts: { lt: MAX_ATTEMPTS } },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: {
      id: true,
      event: true,
      payload: true,
      attempts: true,
      createdAt: true,
      webhook: { select: { id: true, url: true, secret: true, isActive: true } },
    },
  });

  for (const delivery of pending) {
    if (!delivery.webhook.isActive) continue;

    // Backoff is worked out from the row rather than held in memory, so a
    // restart does not retry a hundred failures at once.
    const waitMinutes = BACKOFF_MINUTES[Math.min(delivery.attempts, BACKOFF_MINUTES.length - 1)];
    const readyAt = delivery.createdAt.getTime() + waitMinutes * 60_000;
    if (Date.now() < readyAt) continue;

    result.attempted += 1;

    const body = JSON.stringify(delivery.payload);
    const timestamp = String(Math.floor(Date.now() / 1000));

    let status: number | null = null;
    try {
      const response = await fetch(delivery.webhook.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-webhook-event': delivery.event,
          'x-webhook-timestamp': timestamp,
          'x-webhook-signature': sign(delivery.webhook.secret, timestamp, body),
        },
        body,
        // Somebody else's slow server should not hold a scheduled run open.
        signal: AbortSignal.timeout(10_000),
      });
      status = response.status;
    } catch {
      status = null;
    }

    const ok = status !== null && status >= 200 && status < 300;

    await db.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        attempts: { increment: 1 },
        responseCode: status,
        deliveredAt: ok ? new Date() : null,
      },
    });

    await db.webhook.update({
      where: { id: delivery.webhook.id },
      data: { lastStatus: status },
    });

    if (ok) result.delivered += 1;
    else result.failed += 1;
  }

  return result;
}

/** Every event a hook can subscribe to, declared so the form is a list. */
export const WEBHOOK_EVENTS = [
  { key: 'lead.created', label: 'An enquiry came in' },
  { key: 'enrolment.created', label: 'Somebody was enrolled' },
  { key: 'payment.captured', label: 'A payment succeeded' },
  { key: 'payment.refunded', label: 'A refund went through' },
  { key: 'course.completed', label: 'Somebody finished a course' },
  { key: 'certificate.issued', label: 'A certificate was issued' },
  { key: 'session.cancelled', label: 'A class was called off' },
  { key: 'attendance.recorded', label: 'Somebody joined a class' },
] as const;
