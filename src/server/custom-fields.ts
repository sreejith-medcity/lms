'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { $Enums, Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { recordAudit } from '@/lib/audit';
import { slugify } from '@/lib/slug';
import type { ActionState } from '@/server/courses';

/**
 * Defining a custom field.
 *
 * The key is derived once and then frozen. Every value ever stored points at
 * the definition rather than the label, so renaming a field is free and
 * changing its key would orphan the answers — which is exactly the sort of
 * quiet data loss a settings screen should make impossible rather than warn
 * about.
 */

async function guard(action: 'view' | 'edit' | 'delete' = 'edit') {
  const [tenant, user] = await Promise.all([
    requireTenant(),
    requireStaff('settings.custom_fields', action),
  ]);
  if (user.organizationId !== tenant.organizationId) throw new Error('FORBIDDEN');
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  if (message === 'FORBIDDEN') return { error: 'You do not have permission to do that.' };
  console.error('[custom-fields]', message);
  return { error: 'Something went wrong. Please try again.' };
}

const fieldShape = z.object({
  entity: z.enum([
    'LEARNER',
    'INSTRUCTOR',
    'COURSE',
    'BATCH',
    'CERTIFICATE',
    'QUESTION',
    'ANNOUNCEMENT',
    'ENQUIRY',
  ]),
  label: z.string().trim().min(2, 'Give the field a label').max(120),
  type: z.enum(['TEXT', 'NUMBER', 'DATE', 'DROPDOWN', 'MULTISELECT', 'BOOLEAN', 'FILE']),
  options: z.string().trim().max(600).optional(),
  signupTiming: z.enum(['BEFORE', 'AFTER']).optional(),
});

export async function saveCustomField(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await guard();

    const id = String(formData.get('id') ?? '');
    const parsed = fieldShape.safeParse({
      entity: formData.get('entity') || 'LEARNER',
      label: formData.get('label'),
      type: formData.get('type') || 'TEXT',
      options: formData.get('options') || undefined,
      signupTiming: formData.get('signupTiming') || undefined,
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const d = parsed.data;

    const options = (d.options ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean)
      .slice(0, 40);

    const needsOptions = d.type === 'DROPDOWN' || d.type === 'MULTISELECT';
    if (needsOptions && options.length < 2) {
      return { error: 'A list needs at least two choices.' };
    }

    const showOnSignup = formData.get('showOnSignup') === 'on';
    const showOnOfflineForm = formData.get('showOnOfflineForm') === 'on';

    const data = {
      label: d.label,
      type: d.type as $Enums.CustomFieldType,
      options: needsOptions ? (options as unknown as Prisma.InputJsonValue) : undefined,
      showOnSignup,
      signupTiming: showOnSignup ? ((d.signupTiming ?? 'AFTER') as $Enums.SignupTiming) : null,
      signupRequired: showOnSignup && formData.get('signupRequired') === 'on',
      showOnOfflineForm,
      offlineRequired: showOnOfflineForm && formData.get('offlineRequired') === 'on',
    };

    if (id) {
      const existing = await db.customFieldDefinition.findFirst({
        where: { id, organizationId: tenant.organizationId },
        select: { id: true },
      });
      if (!existing) return { error: 'Field not found.' };

      // The key is deliberately not in `data`: every stored answer points at it.
      await db.customFieldDefinition.update({ where: { id }, data });
    } else {
      const base = slugify(d.label).replace(/-/g, '_') || 'field';

      const taken = await db.customFieldDefinition.findMany({
        where: { organizationId: tenant.organizationId, entity: d.entity },
        select: { key: true, sortOrder: true },
      });
      const keys = new Set(taken.map((t) => t.key));

      let key = base;
      let n = 1;
      while (keys.has(key)) {
        n += 1;
        key = `${base}_${n}`;
      }

      await db.customFieldDefinition.create({
        data: {
          organizationId: tenant.organizationId,
          entity: d.entity,
          key,
          sortOrder: taken.length,
          ...data,
        },
      });
    }

    await recordAudit({
      organizationId: tenant.organizationId,
      actorId: user.id,
      action: id ? 'custom_field.updated' : 'custom_field.created',
      entity: 'CustomFieldDefinition',
      entityId: id || 'new',
      after: { entity: d.entity, label: d.label, type: d.type },
    });

    revalidatePath('/admin/settings/custom-fields');
    return { ok: true, message: 'Saved.' };
  } catch (err) {
    return fail(err);
  }
}

export async function setCustomFieldActive(id: string, isActive: boolean): Promise<ActionState> {
  try {
    const { tenant } = await guard();

    const field = await db.customFieldDefinition.findFirst({
      where: { id, organizationId: tenant.organizationId },
      select: { id: true },
    });
    if (!field) return { error: 'Field not found.' };

    await db.customFieldDefinition.update({ where: { id }, data: { isActive } });

    revalidatePath('/admin/settings/custom-fields');
    return {
      ok: true,
      message: isActive
        ? 'Back on the forms.'
        : 'Off the forms. Answers already given are kept.',
    };
  } catch (err) {
    return fail(err);
  }
}

export async function moveCustomField(id: string, direction: 'up' | 'down'): Promise<ActionState> {
  try {
    const { tenant } = await guard();

    const current = await db.customFieldDefinition.findFirst({
      where: { id, organizationId: tenant.organizationId },
      select: { id: true, entity: true, sortOrder: true },
    });
    if (!current) return { error: 'Field not found.' };

    const neighbour = await db.customFieldDefinition.findFirst({
      where: {
        organizationId: tenant.organizationId,
        entity: current.entity,
        sortOrder: direction === 'up' ? { lt: current.sortOrder } : { gt: current.sortOrder },
      },
      orderBy: { sortOrder: direction === 'up' ? 'desc' : 'asc' },
      select: { id: true, sortOrder: true },
    });
    if (!neighbour) return { ok: true };

    await db.$transaction([
      db.customFieldDefinition.update({
        where: { id: current.id },
        data: { sortOrder: neighbour.sortOrder },
      }),
      db.customFieldDefinition.update({
        where: { id: neighbour.id },
        data: { sortOrder: current.sortOrder },
      }),
    ]);

    revalidatePath('/admin/settings/custom-fields');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteCustomField(id: string): Promise<ActionState> {
  try {
    const { tenant } = await guard('delete');

    const field = await db.customFieldDefinition.findFirst({
      where: { id, organizationId: tenant.organizationId },
      select: { id: true, label: true, _count: { select: { values: true } } },
    });
    if (!field) return { error: 'Field not found.' };

    // Answers are what people told you. Switching the field off keeps them.
    if (field._count.values > 0) {
      return {
        error: `${field._count.values} people have answered this. Switch it off instead of deleting it.`,
      };
    }

    await db.customFieldDefinition.delete({ where: { id } });

    revalidatePath('/admin/settings/custom-fields');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
