import type { $Enums, Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import type { OutboundAttachment } from './types';
import { senderFor } from './index';
import { render } from './render';
import { estimatedCostPaise } from './pricing';
import { canSpend, spend, refund } from './wallet';
import { templateForRow } from './templates';
import { isMarketing, unsubscribeFooter } from '@/lib/consent';
import { randomBytes } from 'node:crypto';
import { organizationOrigin } from '@/lib/org-origin';
import { recordIntegrationEvent } from '@/lib/integration-events';

/**
 * Sending what the outbox decided to send.
 *
 * Four rules, each of them the answer to a way this goes wrong in production.
 *
 * A row is claimed before it is sent. Two overlapping runs of this must not both
 * send the same reminder, so claiming is an UPDATE with the row's current state
 * in the WHERE clause, and only the run that changed a row owns it.
 *
 * A permanent failure is not retried. A number that is not on WhatsApp will
 * never be on WhatsApp, and retrying it costs money and buries the real
 * failures. The adapters classify; this only obeys.
 *
 * A retry backs off. Second attempt in a minute, then five, then twenty five.
 * A provider having a bad ten minutes should not become a thousand requests.
 *
 * Nothing is sent that cannot be rendered. A missing variable stops the message
 * rather than sending "Hi ,", and the row says which variable was missing.
 */

const MAX_ATTEMPTS = 4;
const BACKOFF_MINUTES = [1, 5, 25, 120];

export interface DrainResult {
  claimed: number;
  sent: number;
  failed: number;
  deferred: number;
  blocked: string[];
}

function backoff(attempts: number): Date {
  const minutes = BACKOFF_MINUTES[Math.min(attempts, BACKOFF_MINUTES.length - 1)];
  return new Date(Date.now() + minutes * 60_000);
}

export async function drain(organizationId: string, limit = 100): Promise<DrainResult> {
  const result: DrainResult = { claimed: 0, sent: 0, failed: 0, deferred: 0, blocked: [] };

  // A row claimed by a run that died mid-send sits in SENDING forever. Ten
  // minutes is long enough that no live send is caught by this and short enough
  // that a restart does not strand a batch of reminders until somebody notices.
  await db.notificationLog.updateMany({
    where: { organizationId, status: 'SENDING', createdAt: { lt: new Date(Date.now() - 10 * 60_000) } },
    data: { status: 'QUEUED', nextAttemptAt: new Date() },
  });

  const due = await db.notificationLog.findMany({
    where: {
      organizationId,
      status: 'QUEUED',
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: {
      id: true,
      channel: true,
      eventKey: true,
      target: true,
      context: true,
      templateKey: true,
      attempts: true,
      userId: true,
    },
  });

  if (!due.length) return result;

  // Looked up once per run, and only if a marketing email needs it.
  let origin: string | null = null;

  // One sender per channel per run, not one per message. Resolving a provider
  // reads and decrypts credentials, and doing that four hundred times to send
  // four hundred reminders is most of the work for none of the benefit.
  const senders = new Map<string, Awaited<ReturnType<typeof senderFor>>>();

  for (const row of due) {
    // The two channels delivered inside the product: the bell, and the
    // browser's own push service. Neither has a provider to resolve.
    if (row.channel === 'IN_APP' || row.channel === 'PUSH') {
      const claim = await db.notificationLog.updateMany({ where: { id: row.id, status: 'QUEUED' }, data: { status: 'SENDING', attempts: { increment: 1 } } });
      if (claim.count === 0) continue;
      result.claimed += 1;
      const outcome = await deliverInside(organizationId, row);
      if (outcome === 'sent') result.sent += 1;
      else if (outcome === 'deferred') {
        result.deferred += 1;
        const note = 'Web push keys are not set, so push notifications wait.';
        if (!result.blocked.includes(note)) result.blocked.push(note);
      } else result.failed += 1;
      continue;
    }

    let resolution = senders.get(row.channel);
    if (!resolution) {
      resolution = await senderFor(organizationId, row.channel);
      senders.set(row.channel, resolution);
    }

    if (!resolution.sender) {
      // Left QUEUED on purpose. Nothing is wrong with the message; there is
      // simply nowhere to send it yet, and it should go the moment there is.
      result.deferred += 1;
      if (resolution.reason && !result.blocked.includes(resolution.reason)) {
        result.blocked.push(resolution.reason);
      }
      continue;
    }

    // Claim it. If another run got here first the count is zero and we move on.
    const claim = await db.notificationLog.updateMany({
      where: { id: row.id, status: 'QUEUED' },
      data: { status: 'SENDING', attempts: { increment: 1 } },
    });
    if (claim.count === 0) continue;
    result.claimed += 1;

    const context = (row.context ?? {}) as Record<string, string>;
    const template = await templateForRow(organizationId, row);

    if (!template) {
      await fail(row.id, `No template for ${row.eventKey} on ${row.channel}.`, true);
      result.failed += 1;
      continue;
    }

    const rendered = render(template, context);
    // A marketing email carries the way out. The law in most places asks
    // for it, and so does anyone who has been on the wrong end of a list.
    if (row.channel === 'EMAIL' && row.userId && isMarketing(row.eventKey)) {
      const token = await unsubscribeTokenFor(organizationId, row.userId);
      if (token) {
        origin ??= await organizationOrigin(organizationId);
        if (origin) rendered.body += unsubscribeFooter(`${origin}/unsubscribe/${token}?c=email`);
      }
    }
    if (rendered.missing.length) {
      await fail(
        row.id,
        `Nothing to fill ${rendered.missing.join(', ')}, so it was not sent.`,
        true,
      );
      result.failed += 1;
      continue;
    }

    const cost = estimatedCostPaise(row.channel, rendered.body);

    if (!(await canSpend(organizationId, cost))) {
      // Back to QUEUED rather than FAILED: the message is fine, the balance is
      // not, and it should go out when the wallet is topped up.
      await db.notificationLog.update({
        where: { id: row.id },
        data: {
          status: 'QUEUED',
          nextAttemptAt: new Date(Date.now() + 60 * 60_000),
          error: 'Not enough messaging credit.',
        },
      });
      result.deferred += 1;
      const note = 'The messaging wallet is empty, so paid channels are on hold.';
      if (!result.blocked.includes(note)) result.blocked.push(note);
      continue;
    }

    // Charged before the call, refunded if it fails. The other order lets a
    // timeout that actually delivered go unbilled, which is the expensive
    // mistake of the two.
    if (cost > 0) {
      await spend({
        organizationId,
        paise: cost,
        reason: row.channel,
        channel: row.channel,
        logId: row.id,
      });
    }

    // The file the message is about, drawn now rather than stored in the
    // queue: a receipt is a few kilobytes to render and a few hundred to
    // keep per row for every learner who ever paid.
    const attachments = row.channel === 'EMAIL' ? await attachmentsFor(organizationId, context) : undefined;

    const outcome = await resolution.sender
      .send({
        to: row.target,
        subject: rendered.subject,
        body: rendered.body,
        templateName: template.templateName ?? undefined,
        variables: template.orderedVariables?.(context),
        attachments,
      })
      .catch((err: unknown) => ({
        ok: false as const,
        costPaise: 0,
        error: err instanceof Error ? err.message : String(err),
        permanent: false,
      }));

    if (outcome.ok) {
      await db.notificationLog.update({
        where: { id: row.id },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          provider: resolution.sender.provider,
          providerRef: outcome.providerRef ?? null,
          costPaise: cost,
          error: null,
          nextAttemptAt: null,
        },
      });
      result.sent += 1;
      continue;
    }

    if (cost > 0) {
      await refund({ organizationId, paise: cost, logId: row.id, note: 'Send failed.' });
    }

    const attempts = row.attempts + 1;
    const givingUp = outcome.permanent || attempts >= MAX_ATTEMPTS;

    if (givingUp) {
      await fail(row.id, outcome.error ?? 'The provider refused it.', true);
      result.failed += 1;
    } else {
      await db.notificationLog.update({
        where: { id: row.id },
        data: {
          status: 'QUEUED',
          nextAttemptAt: backoff(attempts),
          error: outcome.error ?? null,
          provider: resolution.sender.provider,
        },
      });
      result.deferred += 1;
    }

    await recordIntegrationEvent({
      organizationId,
      provider: resolution.sender.provider,
      direction: 'OUT',
      action: `${row.eventKey} on ${row.channel}`,
      ok: false,
      detail: outcome.error ?? null,
    });
  }

  if (result.sent > 0) {
    const byProvider = new Map<string, number>();
    for (const [, resolution] of senders) {
      if (resolution.sender) byProvider.set(resolution.sender.provider, 0);
    }
    for (const provider of byProvider.keys()) {
      await recordIntegrationEvent({
        organizationId,
        provider,
        direction: 'OUT',
        action: 'Messages sent',
        ok: true,
        records: result.sent,
      });
    }
  }

  return result;
}

async function fail(id: string, error: string, permanent: boolean): Promise<void> {
  await db.notificationLog.update({
    where: { id },
    data: {
      status: 'FAILED',
      error: error.slice(0, 400),
      nextAttemptAt: permanent ? null : new Date(Date.now() + 60_000),
    },
  });
}

/** Everything waiting, for the screen that asks whether anything is stuck. */
export async function outboxSummary(organizationId: string): Promise<{
  queued: number;
  failed: number;
  sentToday: number;
  byChannel: { channel: $Enums.Channel; queued: number }[];
}> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [queued, failed, sentToday, grouped] = await Promise.all([
    db.notificationLog.count({ where: { organizationId, status: 'QUEUED' } }),
    db.notificationLog.count({ where: { organizationId, status: 'FAILED' } }),
    db.notificationLog.count({
      where: { organizationId, status: { in: ['SENT', 'DELIVERED', 'READ'] }, sentAt: { gte: startOfDay } },
    }),
    db.notificationLog.groupBy({
      by: ['channel'],
      where: { organizationId, status: 'QUEUED' },
      _count: { _all: true },
    }),
  ]);

  return {
    queued,
    failed,
    sentToday,
    byChannel: grouped.map((row) => ({ channel: row.channel, queued: row._count._all })),
  };
}

export type { Prisma };

/** The learner's unsubscribe token, minted on first use. */
async function unsubscribeTokenFor(organizationId: string, userId: string): Promise<string | null> {
  const person = await db.user.findFirst({ where: { id: userId, organizationId }, select: { unsubscribeToken: true } });
  if (!person) return null;
  if (person.unsubscribeToken) return person.unsubscribeToken;
  const token = randomBytes(18).toString('base64url');
  await db.user.update({ where: { id: userId }, data: { unsubscribeToken: token } });
  return token;
}


/**
 * Context keys that name a document to attach: `attachInvoice` and
 * `attachReceipt` carry a number, `attachCertificate` a certificate id,
 * `attachReportRun` the id of a scheduled report's file.
 * A document that cannot be found or drawn is simply not attached; the
 * message still carries its link.
 */
async function attachmentsFor(organizationId: string, context: Record<string, string>): Promise<OutboundAttachment[] | undefined> {
  const out: OutboundAttachment[] = [];
  try {
    if (context.attachInvoice || context.attachReceipt) {
      const { moneyPdf } = await import('@/lib/money-pdf-serve');
      const pdf = context.attachInvoice
        ? await moneyPdf(organizationId, 'INVOICE', context.attachInvoice)
        : await moneyPdf(organizationId, 'RECEIPT', context.attachReceipt);
      if (pdf) out.push({ fileName: pdf.fileName, mimeType: 'application/pdf', base64: Buffer.from(pdf.bytes).toString('base64') });
    }
    if (context.attachReportCard) {
      const { reportCardPdf } = await import('@/lib/report-card-serve');
      const pdf = await reportCardPdf(organizationId, context.attachReportCard);
      if (pdf) out.push({ fileName: pdf.fileName, mimeType: 'application/pdf', base64: Buffer.from(pdf.bytes).toString('base64') });
    }
    if (context.attachCertificate) {
      const { certificatePdfFor } = await import('@/lib/certificate-issue');
      const pdf = await certificatePdfFor(context.attachCertificate, organizationId);
      if (pdf) out.push({ fileName: pdf.fileName, mimeType: 'application/pdf', base64: Buffer.from(pdf.bytes).toString('base64') });
    }
    if (context.attachReportRun) {
      const run = await db.reportRun.findFirst({ where: { id: context.attachReportRun, organizationId }, select: { fileName: true, csv: true } });
      if (run) out.push({ fileName: run.fileName, mimeType: 'text/csv', base64: Buffer.from(run.csv, 'utf8').toString('base64') });
    }
  } catch (err) {
    console.error('[drain] attachment', err instanceof Error ? err.message : err);
  }
  return out.length ? out : undefined;
}


/**
 * IN_APP: the row itself is the message, so it is rendered now and marked
 * sent; the bell reads it back. PUSH: rendered the same way and handed to
 * every subscription the person holds; a learner with no subscription
 * simply has nothing to receive, which is not a failure.
 */
async function deliverInside(
  organizationId: string,
  row: { id: string; channel: $Enums.Channel; eventKey: string; userId: string | null; context: unknown; templateKey: string | null },
): Promise<'sent' | 'failed' | 'deferred'> {
  const context = (row.context ?? {}) as Record<string, string>;
  const template = (await templateForRow(organizationId, { ...row, channel: row.channel })) ?? (await templateForRow(organizationId, { ...row, channel: 'EMAIL' }));
  if (!template) {
    await db.notificationLog.update({ where: { id: row.id }, data: { status: 'FAILED', error: `No template for ${row.eventKey}.` } });
    return 'failed';
  }
  const rendered = render(template, context);
  if (rendered.missing.length) {
    await db.notificationLog.update({ where: { id: row.id }, data: { status: 'FAILED', error: `Nothing to fill ${rendered.missing.join(', ')}.` } });
    return 'failed';
  }
  const kept = { ...context, _renderedSubject: rendered.subject, _renderedBody: rendered.body };

  if (row.channel === 'IN_APP') {
    await db.notificationLog.update({ where: { id: row.id }, data: { status: 'SENT', sentAt: new Date(), provider: 'in-app', context: kept as Prisma.InputJsonValue } });
    return 'sent';
  }

  const { pushConfigured, pushToUser } = await import('./push');
  if (!pushConfigured()) {
    await db.notificationLog.update({ where: { id: row.id }, data: { status: 'QUEUED', nextAttemptAt: new Date(Date.now() + 6 * 60 * 60_000), error: 'Web push keys are not set.' } });
    return 'deferred';
  }
  if (!row.userId) {
    await db.notificationLog.update({ where: { id: row.id }, data: { status: 'FAILED', error: 'Push needs an account to send to.' } });
    return 'failed';
  }
  const url = context.url && context.url.startsWith('/') ? context.url : '/learn/notifications';
  const out = await pushToUser(organizationId, row.userId, { title: rendered.subject || 'Medcity', body: rendered.body.slice(0, 240), url, tag: row.eventKey });
  await db.notificationLog.update({
    where: { id: row.id },
    data: {
      status: out.sent > 0 || out.failed.length === 0 ? 'SENT' : 'FAILED',
      sentAt: new Date(),
      provider: 'web-push',
      providerRef: out.sent ? `${out.sent} device${out.sent === 1 ? '' : 's'}` : null,
      error: out.failed[0] ?? null,
      context: kept as Prisma.InputJsonValue,
    },
  });
  return out.sent > 0 || out.failed.length === 0 ? 'sent' : 'failed';
}
