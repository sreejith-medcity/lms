import { db } from '@/lib/db';
import { allPermissionKeys } from '@/lib/permissions';
import { ensureStandardRoles } from '@/lib/roles-ensure';
import { hashPassword } from '@/lib/password';
import { trialEnd } from './signup';

/**
 * A new academy, from nothing to a sign-in.
 *
 * The same shape the seed builds for Medcity, done as a function so
 * self-serve signup and the platform console call one thing. Each step
 * is recorded as a ProvisioningJob row, so a failure half way leaves a
 * trail rather than a mystery, and running it again finishes what is
 * left rather than doubling anything: every write is an upsert keyed on
 * something stable.
 */

export interface ProvisionInput {
  academyName: string;
  slug: string;
  ownerName: string;
  ownerEmail: string;
  ownerPhone: string;
  password: string;
  planCode: string;
  timezone?: string;
  currency?: string;
  country?: string;
  /** ACTIVE for a tenant the platform creates by hand; TRIALING for self-serve. */
  status?: 'TRIALING' | 'ACTIVE';
}

export interface Provisioned {
  tenantId: string;
  organizationId: string;
  ownerUserId: string;
  hostname: string;
}


const NOTIFICATION_EVENTS = [
  'account.otp', 'account.two_factor', 'account.welcome',
  'session.reminder', 'session.start', 'session.cancelled', 'session.absentee',
  'attendance.absent', 'attendance.late', 'attendance.corrected', 'result.published',
  'payment.received', 'payment.failed', 'instalment.due', 'misc_fee.raised',
  'course.welcome', 'course.completed', 'certificate.issued', 'assessment.marked',
  'assignment.set', 'assignment.graded', 'report_card.issued', 'lesson_question.answered',
  'help.replied', 'badge.earned', 'data_request.closed',
];

const LEARNER_FIELDS: [string, string, string, boolean][] = [
  ['parent_name', 'Parent name', 'TEXT', false],
  ['parent_contact', 'Parent contact no.', 'NUMBER', false],
  ['parent_email', 'Parent email', 'TEXT', false],
  ['area', 'Area', 'TEXT', false],
  ['school_college', 'School or college', 'TEXT', false],
  ['residential_address', 'Residential address', 'TEXT', false],
];

export function baseDomain(): string {
  return (process.env.APP_BASE_DOMAIN ?? 'localhost').split(':')[0].toLowerCase();
}

async function step(tenantId: string, name: string, work: () => Promise<void>) {
  const job = await db.provisioningJob.create({ data: { tenantId, step: name, status: 'RUNNING', startedAt: new Date(), attempts: 1 } });
  try {
    await work();
    await db.provisioningJob.update({ where: { id: job.id }, data: { status: 'DONE', completedAt: new Date() } });
  } catch (err) {
    await db.provisioningJob.update({ where: { id: job.id }, data: { status: 'FAILED', error: err instanceof Error ? err.message : String(err) } });
    throw err;
  }
}

export async function provisionTenant(input: ProvisionInput): Promise<Provisioned> {
  const plan = await db.plan.findFirst({ where: { code: input.planCode, isActive: true }, select: { id: true, trialDays: true, monthlyPaise: true, quarterlyPaise: true } });
  if (!plan) throw new Error('PLAN_NOT_FOUND');
  const now = new Date();
  const status = input.status ?? 'TRIALING';
  const timezone = input.timezone ?? 'Asia/Calcutta';
  const currency = input.currency ?? 'INR';
  const email = input.ownerEmail.trim().toLowerCase();

  const tenant = await db.tenant.upsert({
    where: { slug: input.slug },
    create: {
      slug: input.slug,
      name: input.academyName.trim(),
      ownerEmail: email,
      ownerName: input.ownerName.trim(),
      ownerPhone: input.ownerPhone.trim() || null,
      status,
      currency,
      timezone,
      country: input.country ?? 'IN',
      trialEndsAt: status === 'TRIALING' ? trialEnd(now, plan.trialDays) : null,
    },
    update: {},
    select: { id: true },
  });

  let organizationId = '';
  let ownerUserId = '';
  const hostname = `${input.slug}.${baseDomain()}`;

  await step(tenant.id, 'SUBSCRIPTION', async () => {
    const periodEnd = status === 'TRIALING' ? trialEnd(now, plan.trialDays) : new Date(new Date(now).setMonth(now.getMonth() + 1));
    await db.tenantSubscription.upsert({
      where: { tenantId: tenant.id },
      create: { tenantId: tenant.id, planId: plan.id, status: status === 'TRIALING' ? 'TRIALING' : 'ACTIVE', billingCycle: 'MONTHLY', currency, amountPaise: plan.monthlyPaise, currentPeriodStart: now, currentPeriodEnd: periodEnd },
      update: {},
    });
  });

  await step(tenant.id, 'DOMAIN', async () => {
    await db.tenantDomain.upsert({
      where: { hostname },
      create: { tenantId: tenant.id, hostname, isPrimary: true, isCustom: false, sslStatus: 'ISSUED', verifiedAt: now },
      update: { tenantId: tenant.id },
    });
  });

  await step(tenant.id, 'CREATE_ORG', async () => {
    const org = await db.organization.upsert({
      where: { slug: input.slug },
      create: { tenantId: tenant.id, slug: input.slug, name: input.academyName.trim(), supportEmail: email, timezone, currency, country: input.country ?? 'IN' },
      update: { tenantId: tenant.id },
      select: { id: true },
    });
    organizationId = org.id;
    const branch = await db.branch.upsert({
      where: { organizationId_code: { organizationId: org.id, code: 'MAIN' } },
      create: { organizationId: org.id, code: 'MAIN', name: 'Main' },
      update: {},
      select: { id: true },
    });
    await db.taxConfig.create({ data: { organizationId: org.id, branchId: branch.id, enabled: true, state: 'KERALA', cgstPercent: 9, sgstPercent: 9, igstPercent: 18, pricesAreExclusive: true } }).catch(() => undefined);
  });

  await step(tenant.id, 'SEED_PERMISSIONS', async () => {
    for (const p of allPermissionKeys()) {
      await db.permission.upsert({ where: { key: p.key }, create: { key: p.key, group: p.group, label: p.label }, update: {} });
    }
  });

  await step(tenant.id, 'SEED_ROLES', async () => {
    await ensureStandardRoles(organizationId);
  });

  await step(tenant.id, 'OWNER', async () => {
    const role = await db.role.findFirstOrThrow({ where: { organizationId, name: 'Super Admin' }, select: { id: true } });
    const branch = await db.branch.findFirstOrThrow({ where: { organizationId, code: 'MAIN' }, select: { id: true } });
    const existing = await db.user.findFirst({ where: { organizationId, email }, select: { id: true } });
    const user = existing
      ? await db.user.update({ where: { id: existing.id }, data: { kind: 'STAFF', status: 'ACTIVE' }, select: { id: true } })
      : await db.user.create({
          data: { organizationId, name: input.ownerName.trim(), email, phone: input.ownerPhone.replace(/\D/g, '').slice(-10) || null, passwordHash: await hashPassword(input.password), kind: 'STAFF', status: 'ACTIVE', emailVerifiedAt: null, timezone },
          select: { id: true },
        });
    ownerUserId = user.id;
    await db.userRole.upsert({ where: { userId_roleId: { userId: user.id, roleId: role.id } }, create: { userId: user.id, roleId: role.id }, update: {} });
    await db.branchMembership.upsert({ where: { userId_branchId: { userId: user.id, branchId: branch.id } }, create: { userId: user.id, branchId: branch.id, isPrimary: true }, update: {} });
  });

  await step(tenant.id, 'SEED_NOTIFICATIONS', async () => {
    for (const eventKey of NOTIFICATION_EVENTS) {
      await db.notificationSetting
        .upsert({
          where: { organizationId_eventKey_productId: { organizationId, eventKey, productId: null as never } },
          create: { organizationId, eventKey, emailEnabled: true, pushEnabled: true },
          update: {},
        })
        .catch(() => undefined);
    }
    for (const [i, [key, label, type]] of LEARNER_FIELDS.entries()) {
      await db.customFieldDefinition
        .upsert({
          where: { organizationId_entity_key: { organizationId, entity: 'LEARNER', key } },
          create: { organizationId, entity: 'LEARNER', key, label, type: type as never, sortOrder: i },
          update: {},
        })
        .catch(() => undefined);
    }
  });

  return { tenantId: tenant.id, organizationId, ownerUserId, hostname };
}
