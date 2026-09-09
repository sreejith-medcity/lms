'use server';

import { revalidatePath } from 'next/cache';
import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import { seal } from '@/lib/secrets';
import { integrationById } from '@/lib/integrations';
import { recordIntegrationEvent } from '@/lib/integration-events';
import { resolveIntegration } from '@/lib/integration-store';
import type { ActionState } from '@/server/courses';

/**
 * Connecting something.
 *
 * Secrets are sealed before they are written and never read back to a browser,
 * so a blank secret field means "leave what is there" rather than "clear it".
 * That is the only sane behaviour for a form that cannot show you the current
 * value: the alternative is an academy wiping its live gateway key by editing
 * the sender name.
 */

async function guard(action: 'view' | 'edit' | 'delete' = 'edit') {
  const [tenant, user] = await Promise.all([
    requireTenant(),
    requireStaff('settings.integrations', action),
  ]);
  if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  console.error('[integrations]', message);
  return { error: 'Something went wrong. Please try again.' };
}

export async function saveIntegration(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();

    const provider = String(formData.get('provider') ?? '');
    const def = integrationById(provider);
    if (!def) return { error: 'No such integration.' };

    const existing = await db.integration.findFirst({
      where: { organizationId: tenant.organizationId, provider },
      select: { id: true, credentials: true },
    });
    const stored = (existing?.credentials ?? {}) as Record<string, unknown>;

    const next: Record<string, string> = {};
    const changed: string[] = [];

    for (const field of def.fields) {
      const raw = String(formData.get(field.key) ?? '').trim();

      if (field.kind === 'secret') {
        if (!raw) {
          // Left blank: keep whatever is already sealed in there.
          const keep = stored[field.key];
          if (typeof keep === 'string' && keep) next[field.key] = keep;
          continue;
        }
        next[field.key] = seal(raw);
        changed.push(field.key);
        continue;
      }

      if (raw) {
        next[field.key] = raw;
        if (stored[field.key] !== raw) changed.push(field.key);
      }
    }

    if (field_missing(def.fields.map((f) => f.key), next)) {
      return { error: 'Fill in at least one field, or use Disconnect to clear this.' };
    }

    if (existing) {
      await db.integration.update({
        where: { id: existing.id },
        data: {
          credentials: next as Prisma.InputJsonValue,
          isConnected: true,
          connectedAt: new Date(),
        },
      });
    } else {
      await db.integration.create({
        data: {
          organizationId: tenant.organizationId,
          provider,
          category: def.category,
          credentials: next as Prisma.InputJsonValue,
          isConnected: true,
          connectedAt: new Date(),
        },
      });
    }

    // The values themselves never reach the audit log; which fields moved does.
    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'integration.saved',
      entity: 'Integration',
      entityId: provider,
      after: { fields: changed },
    });

    await recordIntegrationEvent({
      organizationId: tenant.organizationId,
      provider,
      direction: 'OUT',
      action: existing ? 'Credentials updated' : 'Connected',
      records: changed.length,
    });

    revalidatePath('/admin/settings/integrations');

    const resolved = await resolveIntegration(tenant.organizationId, provider);

    return {
      ok: true,
      message:
        def.status === 'planned'
          ? `Saved and sealed. Nothing reads these yet — the code for ${def.name} lands in ${def.landsIn ?? 'a later phase'}.`
          : resolved?.complete
            ? `${def.name} is connected.`
            : `Saved, but something required is still missing, so ${def.name} will not run yet.`,
    };
  } catch (err) {
    return fail(err);
  }
}

/** True when nothing at all would be stored. */
function field_missing(keys: string[], next: Record<string, string>): boolean {
  return keys.every((k) => !next[k]);
}

export async function disconnectIntegration(provider: string): Promise<ActionState> {
  try {
    const { tenant, user } = await guard('delete');

    const def = integrationById(provider);
    if (!def) return { error: 'No such integration.' };

    await db.integration.deleteMany({
      where: { organizationId: tenant.organizationId, provider },
    });

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'integration.disconnected',
      entity: 'Integration',
      entityId: provider,
    });

    await recordIntegrationEvent({
      organizationId: tenant.organizationId,
      provider,
      direction: 'OUT',
      action: 'Disconnected',
    });

    revalidatePath('/admin/settings/integrations');

    const stillEnv = def.fields.some((f) => f.env && process.env[f.env]?.trim());

    return {
      ok: true,
      message: stillEnv
        ? 'Cleared here, but some values are still set in the environment and those keep working.'
        : `${def.name} is disconnected.`,
    };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Asking the provider whether the credentials are real.
 *
 * Only where a genuine check exists. Reporting "connected" because a form was
 * filled in is how somebody finds out at the till that the key was wrong, so
 * anything without a real check says so instead of pretending.
 */
export async function testIntegration(provider: string): Promise<ActionState> {
  try {
    const { tenant } = await guard('view');

    const resolved = await resolveIntegration(tenant.organizationId, provider);
    if (!resolved) return { error: 'No such integration.' };
    if (!resolved.complete) return { error: 'Something required is still blank.' };

    if (provider === 'razorpay') {
      const auth = Buffer.from(
        `${resolved.values.keyId}:${resolved.values.keySecret}`,
      ).toString('base64');

      const response = await fetch('https://api.razorpay.com/v1/payments?count=1', {
        headers: { Authorization: `Basic ${auth}` },
        cache: 'no-store',
      });

      if (response.status === 401) {
        await recordIntegrationEvent({
          organizationId: tenant.organizationId,
          provider,
          direction: 'CHECK',
          action: 'Key check',
          ok: false,
          detail: 'Razorpay returned 401.',
        });
        return { error: 'Razorpay rejected those keys. Check you copied the secret in full.' };
      }
      if (!response.ok) {
        await recordIntegrationEvent({
          organizationId: tenant.organizationId,
          provider,
          direction: 'CHECK',
          action: 'Key check',
          ok: false,
          detail: `Razorpay returned ${response.status}.`,
        });
        return { error: `Razorpay answered ${response.status}. Try again in a moment.` };
      }

      await recordIntegrationEvent({
        organizationId: tenant.organizationId,
        provider,
        direction: 'CHECK',
        action: 'Key check',
        ok: true,
        detail: 'Razorpay accepted the keys.',
      });

      const live = String(resolved.values.keyId).startsWith('rzp_live_');
      return {
        ok: true,
        message: live
          ? 'Razorpay accepted these keys. They are live keys, so real money will move.'
          : 'Razorpay accepted these keys. They are test keys, so no real money will move.',
      };
    }

    return {
      ok: true,
      message:
        'Saved. There is no way to check these without sending something, so this says nothing about whether they are correct.',
    };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Naming the other side's fields.
 *
 * Written into `config`, not into `credentials`, so this form can never
 * overwrite a sealed key. An institute changing what its CRM calls a lead
 * source should not be able to break its payment gateway.
 */
export async function saveIntegrationMapping(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();

    const provider = String(formData.get('provider') ?? '');
    const def = integrationById(provider);
    if (!def) return { error: 'No such integration.' };
    if (!def.mappings?.length) return { error: 'This one has nothing to map.' };

    const mappings: Record<string, string> = {};
    for (const field of def.mappings) {
      const raw = String(formData.get(`map.${field.key}`) ?? '').trim();
      if (raw) mappings[field.key] = raw;
    }

    const existing = await db.integration.findFirst({
      where: { organizationId: tenant.organizationId, provider },
      select: { id: true, config: true },
    });

    const config = { ...((existing?.config ?? {}) as Record<string, unknown>), mappings };

    if (existing) {
      await db.integration.update({
        where: { id: existing.id },
        data: { config: config as Prisma.InputJsonValue },
      });
    } else {
      await db.integration.create({
        data: {
          organizationId: tenant.organizationId,
          provider,
          category: def.category,
          config: config as Prisma.InputJsonValue,
        },
      });
    }

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: 'integration.mapped',
      entity: 'Integration',
      entityId: provider,
      after: { fields: Object.keys(mappings) },
    });

    await recordIntegrationEvent({
      organizationId: tenant.organizationId,
      provider,
      direction: 'OUT',
      action: 'Field mapping saved',
      records: Object.keys(mappings).length,
    });

    revalidatePath('/admin/settings/integrations');

    const unmapped = def.mappings.filter((m) => !mappings[m.key]);

    return {
      ok: true,
      message: unmapped.length
        ? `Saved. ${unmapped.map((m) => m.label).join(', ')} ${unmapped.length === 1 ? 'is' : 'are'} still blank, so ${unmapped.length === 1 ? 'that field' : 'those fields'} will not be sent.`
        : 'Saved. Every field has a name on the other side.',
    };
  } catch (err) {
    return fail(err);
  }
}
