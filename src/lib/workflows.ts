import type { Prisma } from '@prisma/client';
import { createHmac } from 'node:crypto';
import { db } from '@/lib/db';
import { queueNotifications } from '@/lib/notify';
import { credit } from '@/lib/wallet';
import { sweepAbandonedCarts } from '@/lib/cart';
import type { DomainEvent } from '@/lib/events';
import {
  conditionHolds,
  dueAt,
  eventMatches,
  normaliseTag,
  parseStepConfig,
  parseTriggerFilters,
  runKey,
  type LearnerFacts,
} from '@/lib/workflow-rules';

/**
 * Automations: when this happens, do these things, in order, with pauses.
 *
 * A run is a row. Where it has got to and when it is next due are columns,
 * not a timer in a worker's memory, so a restart loses nothing and two
 * instances cannot both take the same step: a run is claimed by moving its
 * due time forward before anything is done with it.
 *
 * Steps that need nobody to wait (a tag, points, a queued message) happen
 * the moment the run starts. Steps behind a delay wait for the scheduler,
 * which runs every few minutes, so "two days later" means two days give or
 * take five minutes. Nothing here may throw into the action that raised the
 * event; a failed step fails the run and says why on the automations page.
 */

const LEASE_MINUTES = 10;
const MAX_STEPS_PER_PASS = 20;

type StepRow = { id: string; sortOrder: number; actionType: string; config: unknown; delayMinutes: number };
type LogLine = { step: number; action: string; at: string; note: string };

/* Starting ------------------------------------------------------------------ */

export async function startWorkflowRuns(event: DomainEvent, only?: { workflowId: string }): Promise<number> {
  const workflows = await db.workflow.findMany({
    where: {
      organizationId: event.organizationId,
      triggerType: event.key,
      isActive: true,
      ...(only ? { id: only.workflowId } : {}),
    },
    select: { id: true, runOnce: true, triggerConfig: true, steps: { orderBy: { sortOrder: 'asc' }, select: { delayMinutes: true } } },
  });
  if (!workflows.length) return 0;

  const person = event.userId ?? event.leadId;
  if (!person) return 0;

  let started = 0;
  const now = new Date();
  for (const wf of workflows) {
    if (!wf.steps.length) continue;
    if (!eventMatches(parseTriggerFilters(wf.triggerConfig), event)) continue;

    const context = {
      event: event.key,
      subjectId: event.subjectId,
      productId: event.productId ?? null,
      batchId: event.batchId ?? null,
      leadId: event.leadId ?? null,
      ...(event.data ?? {}),
    };

    try {
      const run = await db.workflowRun.create({
        data: {
          organizationId: event.organizationId,
          workflowId: wf.id,
          userId: event.userId ?? null,
          context: context as Prisma.InputJsonValue,
          currentStep: 0,
          status: 'RUNNING',
          nextAt: dueAt(wf.steps, 0, now),
          dedupeKey: runKey(wf.id, wf.runOnce, person, event.subjectId),
        },
        select: { id: true, nextAt: true },
      });
      started += 1;
      // The immediate steps happen now rather than on the next scheduler
      // tick: a welcome tag should be on the learner before the page reloads.
      if (run.nextAt <= now) await advanceRun(run.id).catch(() => undefined);
    } catch (err) {
      // The same person and subject already started this one. That is the
      // dedupe key doing its job, not an error.
      const code = (err as { code?: string }).code;
      if (code !== 'P2002') console.error('[workflows] could not start', err instanceof Error ? err.message : err);
    }
  }
  return started;
}

/* Running ------------------------------------------------------------------- */

export interface RunnerResult {
  picked: number;
  finished: number;
  failed: number;
}

/** Every run in this academy whose next step is due. */
export async function runDueWorkflows(organizationId: string, limit = 50): Promise<RunnerResult> {
  const due = await db.workflowRun.findMany({
    where: { organizationId, status: 'RUNNING', nextAt: { lte: new Date() } },
    orderBy: { nextAt: 'asc' },
    take: limit,
    select: { id: true },
  });
  const result: RunnerResult = { picked: 0, finished: 0, failed: 0 };
  for (const run of due) {
    const outcome = await advanceRun(run.id);
    if (outcome === 'skipped') continue;
    result.picked += 1;
    if (outcome === 'finished' || outcome === 'stopped') result.finished += 1;
    if (outcome === 'failed') result.failed += 1;
  }
  return result;
}

/**
 * Take one run as far as it can go right now: through every step that is
 * due, stopping at the first delay, a condition that says no, or an error.
 */
export async function advanceRun(runId: string): Promise<'skipped' | 'waiting' | 'finished' | 'stopped' | 'failed'> {
  const now = new Date();
  // Claim it. Moving nextAt forward is the lease; a second runner finds
  // nothing due and moves on.
  const claimed = await db.workflowRun.updateMany({
    where: { id: runId, status: 'RUNNING', nextAt: { lte: now } },
    data: { nextAt: new Date(now.getTime() + LEASE_MINUTES * 60_000) },
  });
  if (claimed.count === 0) return 'skipped';

  const run = await db.workflowRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      organizationId: true,
      userId: true,
      context: true,
      currentStep: true,
      log: true,
      workflow: { select: { id: true, name: true, steps: { orderBy: { sortOrder: 'asc' } } } },
    },
  });
  if (!run) return 'skipped';

  const steps: StepRow[] = run.workflow.steps;
  const log: LogLine[] = Array.isArray(run.log) ? (run.log as LogLine[]) : [];
  const context = (run.context ?? {}) as Record<string, unknown>;
  let index = run.currentStep;
  let passes = 0;

  const finish = async (status: 'DONE' | 'STOPPED' | 'FAILED', error?: string) => {
    await db.workflowRun.update({
      where: { id: run.id },
      data: { status, completedAt: new Date(), currentStep: index, log: log as unknown as Prisma.InputJsonValue, error: error ?? null },
    });
  };

  while (index < steps.length && passes < MAX_STEPS_PER_PASS) {
    const step = steps[index];
    const config = parseStepConfig(step.config);
    passes += 1;

    try {
      const outcome = await performStep({ organizationId: run.organizationId, userId: run.userId, workflowName: run.workflow.name, runId: run.id }, step.actionType, config, context);
      log.push({ step: index, action: step.actionType, at: new Date().toISOString(), note: outcome.note });
      if (outcome.stop) {
        await finish('STOPPED');
        return 'stopped';
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.push({ step: index, action: step.actionType, at: new Date().toISOString(), note: `Failed: ${message}` });
      await finish('FAILED', message);
      return 'failed';
    }

    index += 1;
    if (index < steps.length) {
      const next = dueAt(steps, index, new Date());
      if (next > new Date()) {
        await db.workflowRun.update({
          where: { id: run.id },
          data: { currentStep: index, nextAt: next, log: log as unknown as Prisma.InputJsonValue },
        });
        return 'waiting';
      }
    }
  }

  if (index >= steps.length) {
    await finish('DONE');
    return 'finished';
  }

  // Hit the per-pass ceiling on a long chain; come back straight away.
  await db.workflowRun.update({ where: { id: run.id }, data: { currentStep: index, nextAt: new Date(), log: log as unknown as Prisma.InputJsonValue } });
  return 'waiting';
}

/* Steps --------------------------------------------------------------------- */

interface StepScope {
  organizationId: string;
  userId: string | null;
  workflowName: string;
  runId: string;
}

async function performStep(
  scope: StepScope,
  actionType: string,
  config: ReturnType<typeof parseStepConfig>,
  context: Record<string, unknown>,
): Promise<{ note: string; stop?: boolean }> {
  switch (actionType) {
    case 'WAIT':
      return { note: 'Waited.' };

    case 'SEND_MESSAGE':
      return sendMessage(scope, config, context);

    case 'ADD_TAG':
    case 'REMOVE_TAG': {
      const user = await requireLearner(scope);
      const tag = normaliseTag(config.tag ?? '');
      if (!tag) return { note: 'No tag given, nothing changed.' };
      const has = user.tags.includes(tag);
      const tags = actionType === 'ADD_TAG' ? (has ? user.tags : [...user.tags, tag]) : user.tags.filter((t) => t !== tag);
      await db.user.update({ where: { id: user.id }, data: { tags } });
      return { note: actionType === 'ADD_TAG' ? (has ? `Already tagged "${tag}".` : `Tagged "${tag}".`) : has ? `Removed "${tag}".` : `Did not have "${tag}".` };
    }

    case 'ADD_POINTS': {
      const user = await requireLearner(scope);
      const points = config.points ?? 0;
      if (points <= 0) return { note: 'No points given.' };
      await credit({ userId: user.id, points, reason: 'ADMIN', note: config.note || `Automation: ${scope.workflowName}` });
      return { note: `Credited ${points} points.` };
    }

    case 'FOLLOW_UP': {
      const lead = await leadFor(scope, context);
      if (!lead) return { note: 'Nobody to follow up with.' };
      const dueAtDate = new Date(Date.now() + (config.daysFromNow ?? 1) * 864e5);
      await db.followUp.create({
        data: { leadId: lead.id, dueAt: dueAtDate, channel: config.followUpChannel ?? 'CALL', note: config.note || `From the automation "${scope.workflowName}".`, ownerId: lead.ownerId },
      });
      return { note: `Follow-up by ${(config.followUpChannel ?? 'CALL').toLowerCase()} on ${dueAtDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}.` };
    }

    case 'ENROL': {
      const user = await requireLearner(scope);
      if (!config.productId) return { note: 'No course chosen.' };
      const product = await db.product.findFirst({
        where: { id: config.productId, organizationId: scope.organizationId, deletedAt: null },
        select: { id: true, title: true, course: { select: { id: true } } },
      });
      if (!product) return { note: 'That course no longer exists.' };
      const already = await db.enrollment.findFirst({
        where: { organizationId: scope.organizationId, userId: user.id, productId: product.id, status: { in: ['ENROLLED', 'REGISTERED', 'COMPLETED'] } },
        select: { id: true },
      });
      if (already) return { note: `Already enrolled in ${product.title}.` };
      const branch = await db.branch.findFirst({ where: { organizationId: scope.organizationId, isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true } });
      if (!branch) throw new Error('The academy has no active branch to enrol into.');
      const batch = product.course
        ? await db.batch.findFirst({
            where: { organizationId: scope.organizationId, courseId: product.course.id, status: { in: ['ACTIVE', 'UPCOMING'] } },
            orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
            select: { id: true },
          })
        : null;
      const created = await db.enrollment.create({
        data: { organizationId: scope.organizationId, branchId: branch.id, userId: user.id, productId: product.id, batchId: batch?.id, status: 'ENROLLED', source: 'FREE_PREVIEW', startsAt: new Date() },
        select: { id: true },
      });
      // Announced like any other enrolment, so a rule on "enrolled in X" can
      // follow one on "finished Y". The dedupe keys stop a loop between two
      // rules from running more than once per person.
      const { happened } = await import('@/lib/events');
      await happened({ organizationId: scope.organizationId, key: 'enrolment.created', userId: user.id, subjectId: created.id, productId: product.id, batchId: batch?.id ?? null, data: { enrollmentId: created.id, item: product.title, source: 'AUTOMATION' } });
      return { note: `Enrolled in ${product.title}.` };
    }

    case 'CONDITION': {
      const facts = await factsAbout(scope);
      const holds = conditionHolds(config, facts);
      return holds ? { note: 'Condition held; carried on.' } : { note: 'Condition did not hold; stopped here.', stop: true };
    }

    case 'WEBHOOK': {
      if (!config.url) return { note: 'No URL.' };
      const body = JSON.stringify({ automation: scope.workflowName, runId: scope.runId, userId: scope.userId, sentAt: new Date().toISOString(), data: context });
      const timestamp = String(Math.floor(Date.now() / 1000));
      const headers: Record<string, string> = { 'content-type': 'application/json', 'x-lms-timestamp': timestamp };
      if (config.secret) headers['x-lms-signature'] = `v1=${createHmac('sha256', config.secret).update(`${timestamp}.${body}`).digest('hex')}`;
      const res = await fetch(config.url, { method: 'POST', headers, body, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`The URL answered ${res.status}.`);
      return { note: `Called the URL, answered ${res.status}.` };
    }

    default:
      throw new Error(`Unknown step "${actionType}".`);
  }
}

async function requireLearner(scope: StepScope) {
  if (!scope.userId) throw new Error('This step needs a learner, and the event was about an enquiry with no account.');
  const user = await db.user.findFirst({
    where: { id: scope.userId, organizationId: scope.organizationId },
    select: { id: true, name: true, email: true, phone: true, tags: true },
  });
  if (!user) throw new Error('The learner no longer exists.');
  return user;
}

/** The enquiry this run is about, or the learner's enquiry, or one made for them. */
async function leadFor(scope: StepScope, context: Record<string, unknown>) {
  const leadId = typeof context.leadId === 'string' ? context.leadId : null;
  if (leadId) {
    const lead = await db.lead.findFirst({ where: { id: leadId, organizationId: scope.organizationId }, select: { id: true, ownerId: true } });
    if (lead) return lead;
  }
  if (!scope.userId) return null;
  const user = await requireLearner(scope);
  const existing = await db.lead.findFirst({
    where: {
      organizationId: scope.organizationId,
      OR: [{ convertedUserId: user.id }, ...(user.email ? [{ email: user.email }] : []), ...(user.phone ? [{ phone: user.phone }] : [])],
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, ownerId: true },
  });
  if (existing) return existing;
  return db.lead.create({
    data: { organizationId: scope.organizationId, name: user.name, email: user.email, phone: user.phone, source: 'AUTOMATION', stage: 'CONTACTED', convertedUserId: user.id },
    select: { id: true, ownerId: true },
  });
}

async function factsAbout(scope: StepScope): Promise<LearnerFacts> {
  if (!scope.userId) return { enrolledProductIds: [], tags: [], hasPaid: false, lastActiveAt: null };
  const [user, enrolments, paid, activity] = await Promise.all([
    db.user.findFirst({ where: { id: scope.userId, organizationId: scope.organizationId }, select: { tags: true } }),
    db.enrollment.findMany({ where: { userId: scope.userId, organizationId: scope.organizationId, status: { in: ['ENROLLED', 'REGISTERED', 'COMPLETED'] } }, select: { productId: true, lastActivityAt: true } }),
    db.payment.findFirst({ where: { userId: scope.userId, organizationId: scope.organizationId, status: 'CAPTURED' }, select: { id: true } }),
    db.attendance.findFirst({ where: { userId: scope.userId, status: { in: ['PRESENT', 'LATE'] } }, orderBy: { joinedAt: 'desc' }, select: { joinedAt: true } }),
  ]);
  const times = [...enrolments.map((e) => e.lastActivityAt), activity?.joinedAt ?? null].filter((d): d is Date => d instanceof Date);
  return {
    enrolledProductIds: enrolments.map((e) => e.productId),
    tags: user?.tags ?? [],
    hasPaid: Boolean(paid),
    lastActiveAt: times.length ? new Date(Math.max(...times.map((d) => d.getTime()))) : null,
  };
}

async function sendMessage(scope: StepScope, config: ReturnType<typeof parseStepConfig>, context: Record<string, unknown>) {
  const user = await requireLearner(scope);
  const organization = await db.organization.findUnique({ where: { id: scope.organizationId }, select: { name: true } });

  let channel = config.channel;
  let templateKey: string | undefined;
  if (config.templateId) {
    const template = await db.messageTemplate.findFirst({ where: { id: config.templateId, organizationId: scope.organizationId }, select: { id: true, channel: true } });
    if (!template) throw new Error('The template this step used has been deleted.');
    if (template.channel !== 'EMAIL' && template.channel !== 'SMS' && template.channel !== 'WHATSAPP') throw new Error('Only email, SMS and WhatsApp templates can be sent from here.');
    channel = template.channel;
    templateKey = `tpl:${template.id}`;
  } else {
    templateKey = 'inline';
  }
  if (!channel) throw new Error('No channel chosen.');

  const strings: Record<string, string> = {};
  for (const [k, v] of Object.entries(context)) if (typeof v === 'string' || typeof v === 'number') strings[k] = String(v);

  const result = await queueNotifications({
    organizationId: scope.organizationId,
    eventKey: `workflow:${scope.workflowName}`,
    recipients: [{ userId: user.id, email: user.email, phone: user.phone }],
    channels: [channel],
    dedupeKey: `run:${scope.runId}:${templateKey}`,
    templateKey,
    context: {
      ...strings,
      name: user.name,
      organization: organization?.name ?? '',
      ...(templateKey === 'inline' ? { _subject: config.subject ?? '', _body: config.body ?? '' } : {}),
    },
  });
  if (result.unreachable > 0 && result.queued === 0) return { note: `No ${channel.toLowerCase()} address on file; nothing sent.` };
  return { note: `Queued a ${channel.toLowerCase()}.` };
}

/* Scheduled triggers -------------------------------------------------------- */

export interface SweepResult {
  inactive: number;
  absent: number;
  carts: number;
}

/**
 * The events nothing raises on its own: a learner going quiet, somebody not
 * turning up, a cart going cold. Found by looking, on the scheduler, and only
 * when an automation is listening for them.
 */
export async function sweepScheduledTriggers(organizationId: string): Promise<SweepResult> {
  const result: SweepResult = { inactive: 0, absent: 0, carts: 0 };
  const listening = await db.workflow.findMany({
    where: { organizationId, isActive: true, triggerType: { in: ['learner.inactive', 'session.absent', 'cart.abandoned'] } },
    select: { id: true, triggerType: true, triggerConfig: true },
  });

  for (const wf of listening.filter((w) => w.triggerType === 'learner.inactive')) {
    const filters = parseTriggerFilters(wf.triggerConfig);
    const cutoff = new Date(Date.now() - filters.days * 864e5);
    const quiet = await db.enrollment.findMany({
      where: {
        organizationId,
        status: 'ENROLLED',
        ...(filters.productIds.length ? { productId: { in: filters.productIds } } : {}),
        OR: [{ lastActivityAt: { lt: cutoff } }, { lastActivityAt: null, startsAt: { lt: cutoff } }],
      },
      select: { id: true, userId: true, productId: true, batchId: true, product: { select: { title: true } } },
      take: 200,
    });
    for (const e of quiet) {
      result.inactive += await startWorkflowRuns(
        { organizationId, key: 'learner.inactive', userId: e.userId, subjectId: `${e.id}:${monthKey()}`, productId: e.productId, batchId: e.batchId, data: { enrollmentId: e.id, item: e.product.title, days: filters.days } },
        { workflowId: wf.id },
      );
    }
  }

  if (listening.some((w) => w.triggerType === 'session.absent')) {
    const since = new Date(Date.now() - 24 * 3600_000);
    const ended = await db.liveSession.findMany({
      where: { organizationId, batchId: { not: null }, status: { not: 'CANCELLED' }, endsAt: { gte: since, lte: new Date() } },
      select: {
        id: true,
        title: true,
        startsAt: true,
        batchId: true,
        batch: { select: { name: true, enrollments: { where: { status: { in: ['ENROLLED', 'REGISTERED'] } }, select: { userId: true } } } },
        attendances: { where: { status: { in: ['PRESENT', 'LATE', 'EXCUSED'] } }, select: { userId: true } },
      },
      take: 50,
    });
    const { happened } = await import('@/lib/events');
    for (const s of ended) {
      const came = new Set(s.attendances.map((a) => a.userId));
      for (const e of s.batch?.enrollments ?? []) {
        if (came.has(e.userId)) continue;
        await happened({ organizationId, key: 'session.absent', userId: e.userId, subjectId: s.id, batchId: s.batchId, data: { sessionId: s.id, title: s.title, startsAt: s.startsAt.toISOString(), batch: s.batch?.name ?? null } });
        result.absent += 1;
      }
    }
  }

  if (listening.some((w) => w.triggerType === 'cart.abandoned')) {
    result.carts = await sweepAbandonedCarts(organizationId);
  }

  return result;
}

const monthKey = () => new Date().toISOString().slice(0, 7);

/** For the automations page: how a workflow has been doing. */
export async function runSummary(organizationId: string, workflowIds: string[]) {
  const rows = await db.workflowRun.groupBy({
    by: ['workflowId', 'status'],
    where: { organizationId, workflowId: { in: workflowIds } },
    _count: { _all: true },
  });
  const out: Record<string, { running: number; done: number; stopped: number; failed: number }> = {};
  for (const id of workflowIds) out[id] = { running: 0, done: 0, stopped: 0, failed: 0 };
  for (const r of rows) {
    const bucket = out[r.workflowId];
    if (!bucket) continue;
    if (r.status === 'RUNNING') bucket.running = r._count._all;
    if (r.status === 'DONE') bucket.done = r._count._all;
    if (r.status === 'STOPPED') bucket.stopped = r._count._all;
    if (r.status === 'FAILED') bucket.failed = r._count._all;
  }
  return out;
}
