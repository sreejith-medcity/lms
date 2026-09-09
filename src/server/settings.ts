'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import type { ActionState } from '@/server/courses';
import { LEARNER_NAV_ITEMS, LEARNER_NAV_SETTING } from '@/lib/learner-nav';
import { settingByKey } from '@/lib/settings/registry';
import { ALL_EVENTS } from '@/lib/notification-events';
import type { Prisma } from '@prisma/client';

async function guard(permission: string, action: 'view' | 'edit' | 'delete' = 'edit') {
  const [tenant, user] = await Promise.all([requireTenant(), requireStaff(permission, action)]);
  if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to change this.' };
  console.error('[settings]', message);
  return { error: 'Something went wrong. Please try again.' };
}

/* Organisation ------------------------------------------------------------ */

const organisation = z.object({
  name: z.string().trim().min(2, 'The academy needs a name').max(160),
  legalName: z.string().trim().max(200).optional().or(z.literal('')),
  website: z.string().trim().url('That does not look like a full URL').optional().or(z.literal('')),
  supportEmail: z.string().trim().email('That email address does not look right').optional().or(z.literal('')),
  contactNumber: z.string().trim().max(30).optional().or(z.literal('')),
  addressLine: z.string().trim().max(240).optional().or(z.literal('')),
  city: z.string().trim().max(80).optional().or(z.literal('')),
  state: z.string().trim().max(80).optional().or(z.literal('')),
  pincode: z.string().trim().max(12).optional().or(z.literal('')),
  timezone: z.string().trim().max(60),
  currency: z.string().trim().length(3, 'Use a three letter code such as INR'),
});

export async function updateOrganisation(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('settings.organization');

    const parsed = organisation.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const d = parsed.data;
    const before = await db.organization.findUnique({
      where: { id: tenant.organizationId },
      select: { name: true, supportEmail: true, currency: true },
    });

    await db.organization.update({
      where: { id: tenant.organizationId },
      data: {
        name: d.name,
        legalName: d.legalName || null,
        website: d.website || null,
        supportEmail: d.supportEmail || null,
        contactNumber: d.contactNumber || null,
        addressLine: d.addressLine || null,
        city: d.city || null,
        state: d.state || null,
        pincode: d.pincode || null,
        timezone: d.timezone,
        currency: d.currency.toUpperCase(),
      },
    });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'settings.organization.updated',
      entity: 'Organization',
      entityId: tenant.organizationId,
      before,
      after: { name: d.name, supportEmail: d.supportEmail, currency: d.currency },
    });

    revalidatePath('/admin/settings');
    revalidatePath('/', 'layout');
    return { ok: true, message: 'Saved.' };
  } catch (err) {
    return fail(err);
  }
}

/* Branding ---------------------------------------------------------------- */

const HEX = /^#[0-9a-fA-F]{6}$/;

export async function updateBranding(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('settings.preferences');

    const brandColor = String(formData.get('brandColor') ?? '').trim();
    const logoUrl = String(formData.get('logoUrl') ?? '').trim();
    const faviconUrl = String(formData.get('faviconUrl') ?? '').trim();

    if (!HEX.test(brandColor)) {
      return { error: 'The brand colour needs to be a six digit hex value, such as #087447.' };
    }

    const before = await db.organization.findUnique({
      where: { id: tenant.organizationId },
      select: { brandColor: true },
    });

    await db.organization.update({
      where: { id: tenant.organizationId },
      data: {
        brandColor,
        logoUrl: logoUrl || null,
        faviconUrl: faviconUrl || null,
      },
    });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'settings.branding.updated',
      entity: 'Organization',
      entityId: tenant.organizationId,
      before,
      after: { brandColor },
    });

    // The accent is injected in the root layout, so every page has to re-render.
    revalidatePath('/', 'layout');
    return { ok: true, message: 'Saved. The new accent is live everywhere.' };
  } catch (err) {
    return fail(err);
  }
}

/* Branches ---------------------------------------------------------------- */

const branch = z.object({
  id: z.string().optional().or(z.literal('')),
  name: z.string().trim().min(2, 'Give the branch a name').max(120),
  code: z.string().trim().min(2, 'Give the branch a short code').max(20),
  city: z.string().trim().max(80).optional().or(z.literal('')),
  state: z.string().trim().max(80).optional().or(z.literal('')),
  addressLine: z.string().trim().max(240).optional().or(z.literal('')),
});

export async function saveBranch(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('settings.branches');

    const parsed = branch.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const d = parsed.data;
    const data = {
      name: d.name,
      code: d.code.toUpperCase(),
      city: d.city || null,
      state: d.state || null,
      addressLine: d.addressLine || null,
    };

    if (d.id) {
      const owned = await db.branch.findFirst({
        where: { id: d.id, organizationId: tenant.organizationId },
        select: { id: true },
      });
      if (!owned) return { error: 'Branch not found.' };
      await db.branch.update({ where: { id: d.id }, data });
    } else {
      const clash = await db.branch.findFirst({
        where: { organizationId: tenant.organizationId, code: data.code },
        select: { id: true },
      });
      if (clash) return { error: `A branch with the code ${data.code} already exists.` };

      await db.branch.create({ data: { ...data, organizationId: tenant.organizationId } });
    }

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: d.id ? 'settings.branch.updated' : 'settings.branch.created',
      entity: 'Branch',
      entityId: d.id || null,
      after: data,
    });

    revalidatePath('/admin/settings/branches');
    return { ok: true, message: 'Saved.' };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Branches are never deleted. Batches, enrolments and orders all point at one,
 * and removing it would orphan financial history. Deactivating hides it from
 * every picker instead.
 */
export async function setBranchActive(branchId: string, isActive: boolean): Promise<ActionState> {
  try {
    const { tenant } = await guard('settings.branches');

    if (!isActive) {
      const remaining = await db.branch.count({
        where: { organizationId: tenant.organizationId, isActive: true, id: { not: branchId } },
      });
      if (remaining === 0) {
        return { error: 'This is the only active branch. Enrolment would have nowhere to go.' };
      }
    }

    await db.branch.updateMany({
      where: { id: branchId, organizationId: tenant.organizationId },
      data: { isActive },
    });

    revalidatePath('/admin/settings/branches');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/* Tax --------------------------------------------------------------------- */

const tax = z.object({
  enabled: z.boolean(),
  gstin: z.string().trim().max(20).optional().or(z.literal('')),
  pan: z.string().trim().max(15).optional().or(z.literal('')),
  state: z.string().trim().max(80).optional().or(z.literal('')),
  cgstPercent: z.coerce.number().min(0).max(50),
  sgstPercent: z.coerce.number().min(0).max(50),
  igstPercent: z.coerce.number().min(0).max(50),
  pricesAreExclusive: z.boolean(),
});

export async function updateTax(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('settings.taxes');

    const parsed = tax.safeParse({
      enabled: formData.get('enabled') === 'on',
      gstin: formData.get('gstin') || '',
      pan: formData.get('pan') || '',
      state: formData.get('state') || '',
      cgstPercent: formData.get('cgstPercent'),
      sgstPercent: formData.get('sgstPercent'),
      igstPercent: formData.get('igstPercent'),
      pricesAreExclusive: formData.get('pricesAreExclusive') === 'on',
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const d = parsed.data;

    const existing = await db.taxConfig.findFirst({
      where: { organizationId: tenant.organizationId, branchId: null },
      select: { id: true },
    });

    const data = {
      enabled: d.enabled,
      gstin: d.gstin || null,
      pan: d.pan || null,
      state: d.state || null,
      cgstPercent: d.cgstPercent,
      sgstPercent: d.sgstPercent,
      igstPercent: d.igstPercent,
      pricesAreExclusive: d.pricesAreExclusive,
    };

    if (existing) {
      await db.taxConfig.update({ where: { id: existing.id }, data });
    } else {
      await db.taxConfig.create({ data: { ...data, organizationId: tenant.organizationId } });
    }

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'settings.tax.updated',
      entity: 'TaxConfig',
      after: data,
    });

    revalidatePath('/admin/settings/taxes');
    return {
      ok: true,
      message: 'Saved. This applies to checkouts started from now on, not to past orders.',
    };
  } catch (err) {
    return fail(err);
  }
}

/**
 * What the learner portal shows across the top, and in what order.
 *
 * Stored as ordered keys rather than a shape, so an item added to the catalogue
 * later does not need a migration, and an item removed from it simply stops
 * rendering instead of becoming a dead link.
 */
export async function saveLearnerNav(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('settings.preferences');

    const keys = formData
      .getAll('navKeys')
      .map(String)
      .filter((key) => LEARNER_NAV_ITEMS.some((item) => item.key === key));

    if (keys.length === 0) return { error: 'Leave at least one item, or learners have nowhere to go.' };

    await db.orgSetting.upsert({
      where: {
        organizationId_key: {
          organizationId: tenant.organizationId,
          key: LEARNER_NAV_SETTING,
        },
      },
      create: {
        organizationId: tenant.organizationId,
        key: LEARNER_NAV_SETTING,
        value: keys,
      },
      update: { value: keys },
    });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'settings.learner_nav.updated',
      entity: 'OrgSetting',
      entityId: LEARNER_NAV_SETTING,
      after: { keys },
    });

    revalidatePath('/learn', 'layout');
    revalidatePath('/admin/settings/learner-portal');
    return { ok: true, message: 'Saved. Learners see it on their next page load.' };
  } catch (err) {
    return fail(err);
  }
}

/* Preferences --------------------------------------------------------------- */

/**
 * Saving one setting at a time.
 *
 * Per setting rather than per form, so a page of forty switches does not become
 * one write that either lands entirely or not at all, and so the audit trail
 * says which switch moved rather than that "preferences changed".
 *
 * A value equal to the default deletes the row instead of storing it, which is
 * what lets an improved default reach every academy that never touched it.
 */
export async function saveSetting(key: string, raw: string): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('settings.preferences');

    const def = settingByKey(key);
    if (!def) return { error: 'No such setting.' };
    if (!def.live) {
      return {
        error: `Nothing reads this yet — it is waiting on ${def.waitingOn ?? 'work still to come'}.`,
      };
    }

    let value: boolean | number | string;
    if (def.kind === 'boolean') {
      value = raw === 'true' || raw === 'on';
    } else if (def.kind === 'number') {
      const n = Number(raw);
      if (!Number.isFinite(n)) return { error: 'That is not a number.' };
      if (def.min != null && n < def.min) return { error: `The lowest this goes is ${def.min}.` };
      if (def.max != null && n > def.max) return { error: `The highest this goes is ${def.max}.` };
      value = n;
    } else if (def.kind === 'select') {
      if (!def.options?.some((o) => o.value === raw)) return { error: 'That is not one of the choices.' };
      value = raw;
    } else {
      value = raw.trim().slice(0, 500);
    }

    const storageKey = `pref.${def.key}`;

    if (value === def.default) {
      await db.orgSetting.deleteMany({
        where: { organizationId: tenant.organizationId, key: storageKey },
      });
    } else {
      await db.orgSetting.upsert({
        where: { organizationId_key: { organizationId: tenant.organizationId, key: storageKey } },
        create: { organizationId: tenant.organizationId, key: storageKey, value },
        update: { value },
      });
    }

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'settings.changed',
      entity: 'OrgSetting',
      entityId: def.key,
      after: { value },
    });

    revalidatePath('/admin/settings/preferences');
    revalidatePath('/', 'layout');

    return {
      ok: true,
      message:
        value === def.default
          ? 'Back to the default, so it will follow any future change to it.'
          : def.effect
            ? def.effect(value)
            : 'Saved.',
    };
  } catch (err) {
    return fail(err);
  }
}

/**
 * The whole configuration as a file.
 *
 * This is a multi-tenant product, so the second academy should not have to
 * rediscover the first one's choices. Only the settings actually changed are
 * exported, which keeps an import from freezing the new tenant on today's
 * defaults.
 */
export async function exportSettings(): Promise<ActionState & { json?: string }> {
  try {
    const { tenant } = await guard('settings.preferences', 'view');

    const rows = await db.orgSetting.findMany({
      where: { organizationId: tenant.organizationId, key: { startsWith: 'pref.' } },
      select: { key: true, value: true },
    });

    const payload = {
      exportedAt: new Date().toISOString(),
      academy: tenant.name,
      note: 'Only settings that differ from their default. Anything absent follows the default.',
      settings: Object.fromEntries(rows.map((r) => [r.key.slice('pref.'.length), r.value])),
    };

    return { ok: true, json: JSON.stringify(payload, null, 2) };
  } catch (err) {
    return fail(err);
  }
}

export async function importSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('settings.preferences');

    const text = String(formData.get('json') ?? '').trim();
    if (!text) return { error: 'Paste the exported file first.' };

    let parsed: { settings?: Record<string, unknown> };
    try {
      parsed = JSON.parse(text);
    } catch {
      return { error: 'That is not valid JSON.' };
    }

    const incoming = parsed.settings;
    if (!incoming || typeof incoming !== 'object') {
      return { error: 'That file has no settings block.' };
    }

    // Unknown keys are reported rather than dropped in silence: a file from a
    // newer version says so, instead of half-importing and looking fine.
    const applied: string[] = [];
    const skipped: string[] = [];

    for (const [key, value] of Object.entries(incoming)) {
      const def = settingByKey(key);
      if (!def || !def.live) {
        skipped.push(key);
        continue;
      }
      const storageKey = `pref.${key}`;
      if (value === def.default) {
        await db.orgSetting.deleteMany({
          where: { organizationId: tenant.organizationId, key: storageKey },
        });
      } else {
        await db.orgSetting.upsert({
          where: { organizationId_key: { organizationId: tenant.organizationId, key: storageKey } },
          create: {
            organizationId: tenant.organizationId,
            key: storageKey,
            value: value as Prisma.InputJsonValue,
          },
          update: { value: value as Prisma.InputJsonValue },
        });
      }
      applied.push(key);
    }

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'settings.imported',
      entity: 'OrgSetting',
      entityId: 'bulk',
      after: { applied: applied.length, skipped: skipped.length },
    });

    revalidatePath('/admin/settings/preferences');
    revalidatePath('/', 'layout');

    return {
      ok: true,
      message:
        skipped.length === 0
          ? `${applied.length} settings applied.`
          : `${applied.length} applied. ${skipped.length} skipped, because this version does not have them: ${skipped.slice(0, 5).join(', ')}${skipped.length > 5 ? '…' : ''}`,
    };
  } catch (err) {
    return fail(err);
  }
}

/**
 * The notification matrix: one event, four channels.
 *
 * Saved a cell at a time, because a grid of sixty switches saved as one form is
 * a form somebody abandons halfway and loses.
 */
export async function setNotificationChannel(
  eventKey: string,
  channel: 'email' | 'sms' | 'whatsapp' | 'push',
  enabled: boolean,
): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('settings.notifications');

    if (!ALL_EVENTS.some((e) => e.key === eventKey)) return { error: 'No such event.' };

    const column =
      channel === 'email'
        ? 'emailEnabled'
        : channel === 'sms'
          ? 'smsEnabled'
          : channel === 'whatsapp'
            ? 'whatsappEnabled'
            : 'pushEnabled';

    // The unique index includes productId, and Prisma's compound key will not
    // take a null there, so the org-wide row is found the ordinary way.
    const existing = await db.notificationSetting.findFirst({
      where: { organizationId: tenant.organizationId, eventKey, productId: null },
      select: { id: true },
    });

    if (existing) {
      await db.notificationSetting.update({
        where: { id: existing.id },
        data: { [column]: enabled },
      });
    } else {
      await db.notificationSetting.create({
        data: {
          organizationId: tenant.organizationId,
          eventKey,
          emailEnabled: channel === 'email' ? enabled : true,
          smsEnabled: channel === 'sms' ? enabled : false,
          whatsappEnabled: channel === 'whatsapp' ? enabled : false,
          pushEnabled: channel === 'push' ? enabled : true,
        },
      });
    }

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'settings.notification.changed',
      entity: 'NotificationSetting',
      entityId: eventKey,
      after: { channel, enabled },
    });

    revalidatePath('/admin/settings/notifications');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
