'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { db } from '@/lib/db';
import { SESSION_COOKIE, getSessionUser } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { hashPassword, verifyPassword } from '@/lib/password';
import { settingBool } from '@/lib/settings/store';
import { fieldsFor, saveFieldValues } from '@/lib/custom-fields';
import { profileCompletion } from '@/lib/profile-completion';
import { buildObjectKey, putObject, sanitiseFileName } from '@/lib/storage';
import { IMAGE_MIME_TYPES } from '@/lib/image-formats';
import { recordAudit } from '@/lib/audit';
import type { ActionState } from '@/server/courses';

/**
 * The learner's own account.
 *
 * What they may change about themselves is the academy's decision (name
 * and email are usually locked, because the certificate and the exam
 * registration have to match), so the three settings are read here and
 * on the page, and a field the page did not offer is not written even if
 * the form carries it.
 */

async function me() {
  const tenant = await requireTenant();
  const user = await getSessionUser();
  if (!user || user.organizationId !== tenant.organizationId) throw new Error('UNAUTHORIZED');
  return { tenant, user };
}

function fail(err: unknown): ActionState {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'UNAUTHORIZED') return { error: 'Please sign in again.' };
  console.error('[account]', message);
  return { error: 'Something went wrong. Please try again.' };
}

const detailsShape = z.object({
  name: z.string().trim().min(2, 'Your name needs at least two characters.').max(120).optional(),
  email: z.string().trim().toLowerCase().email('That email address does not look right.').max(200).optional().or(z.literal('')),
  phone: z.string().trim().max(20).optional(),
  dateOfBirth: z.string().trim().optional(),
  gender: z.string().trim().max(30).optional(),
  occupation: z.string().trim().max(120).optional(),
  schoolOrCollege: z.string().trim().max(160).optional(),
  area: z.string().trim().max(120).optional(),
  residentialAddress: z.string().trim().max(400).optional(),
  permanentAddress: z.string().trim().max(400).optional(),
  parentName: z.string().trim().max(120).optional(),
  parentPhone: z.string().trim().max(20).optional(),
  parentEmail: z.string().trim().toLowerCase().max(200).optional(),
  alternatePhone: z.string().trim().max(20).optional(),
});

export async function saveDetails(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await me();
    const [canName, canEmail, canPhone] = await Promise.all([
      settingBool(tenant.organizationId, 'profile.canEditName'),
      settingBool(tenant.organizationId, 'profile.canEditEmail'),
      settingBool(tenant.organizationId, 'profile.canEditPhone'),
    ]);

    const raw: Record<string, unknown> = {};
    for (const key of Object.keys(detailsShape.shape)) {
      const v = formData.get(key);
      if (v !== null) raw[key] = String(v);
    }
    const parsed = detailsShape.safeParse(raw);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;

    const nullable = (v: string | undefined) => (v === undefined ? undefined : v || null);

    const account: Record<string, unknown> = {
      dateOfBirth: d.dateOfBirth === undefined ? undefined : d.dateOfBirth ? new Date(d.dateOfBirth) : null,
      gender: nullable(d.gender),
    };
    if (canName && d.name !== undefined) account.name = d.name;
    if (canPhone && d.phone !== undefined) account.phone = d.phone || null;
    if (canEmail && d.email !== undefined && d.email !== '') {
      const taken = await db.user.findFirst({
        where: { organizationId: tenant.organizationId, email: d.email, id: { not: user.id } },
        select: { id: true },
      });
      if (taken) return { error: 'That email address is already on another account.' };
      account.email = d.email;
    }
    if (account.dateOfBirth instanceof Date && Number.isNaN(account.dateOfBirth.getTime())) return { error: 'That date of birth does not look right.' };

    await db.user.update({ where: { id: user.id }, data: account });
    await db.learnerProfile.upsert({
      where: { userId: user.id },
      create: { userId: user.id },
      update: {},
    });
    await db.learnerProfile.update({
      where: { userId: user.id },
      data: {
        occupation: nullable(d.occupation),
        schoolOrCollege: nullable(d.schoolOrCollege),
        area: nullable(d.area),
        residentialAddress: nullable(d.residentialAddress),
        permanentAddress: nullable(d.permanentAddress),
        parentName: nullable(d.parentName),
        parentPhone: nullable(d.parentPhone),
        parentEmail: nullable(d.parentEmail),
        alternatePhone: nullable(d.alternatePhone),
      },
    });

    // The academy's own fields, whatever the form carried for them.
    const values: Record<string, string> = {};
    for (const [key, value] of formData.entries()) {
      if (key.startsWith('cf_')) values[key.slice(3)] = String(value);
    }
    // A checkbox left unticked sends nothing, which would leave the old value
    // in place; every boolean field the page showed is listed so it can be
    // written as off.
    for (const key of formData.getAll('cf_booleans').map(String)) if (!(key in values)) values[key] = 'false';
    if (Object.keys(values).length) {
      await saveFieldValues({ organizationId: tenant.organizationId, entity: 'LEARNER', entityId: user.id, userId: user.id, values });
    }

    await refreshCompletion(tenant.organizationId, user.id);
    revalidatePath('/learn/account');
    return { ok: true, message: 'Saved.' };
  } catch (err) {
    return fail(err);
  }
}

const AVATAR_MAX = 3 * 1024 * 1024;

export async function uploadAvatar(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await me();
    const file = formData.get('photo');
    if (!(file instanceof File) || file.size === 0) return { error: 'Pick a picture first.' };
    if (file.size > AVATAR_MAX) return { error: 'Keep the picture under 3 MB.' };
    const mime = (file.type || '').toLowerCase();
    if (!IMAGE_MIME_TYPES.includes(mime as (typeof IMAGE_MIME_TYPES)[number]) || mime === 'image/svg+xml') {
      return { error: 'A JPG, PNG or WebP picture, please.' };
    }

    const fileName = sanitiseFileName(file.name || 'photo');
    const key = buildObjectKey(tenant.organizationId, fileName);
    await putObject(key, new Uint8Array(await file.arrayBuffer()), mime);
    const asset = await db.asset.create({
      data: {
        organizationId: tenant.organizationId,
        name: `Profile photo: ${user.name}`,
        fileName,
        type: 'IMAGE',
        storageKey: key,
        mimeType: mime,
        sizeBytes: BigInt(file.size),
        uploadedById: user.id,
        transcodeStatus: 'READY',
      },
      select: { id: true },
    });
    await db.user.update({ where: { id: user.id }, data: { avatarUrl: `/api/assets/${asset.id}` } });
    await refreshCompletion(tenant.organizationId, user.id);
    revalidatePath('/learn/account');
    revalidatePath('/learn');
    return { ok: true, message: 'Photo updated.' };
  } catch (err) {
    return fail(err);
  }
}

export async function removeAvatar(): Promise<ActionState> {
  try {
    const { tenant, user } = await me();
    await db.user.update({ where: { id: user.id }, data: { avatarUrl: null } });
    await refreshCompletion(tenant.organizationId, user.id);
    revalidatePath('/learn/account');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const passwordShape = z.object({
  current: z.string().min(1, 'Type your current password.'),
  next: z.string().min(8, 'Use at least 8 characters.').max(200),
  again: z.string(),
});

export async function changePassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { tenant, user } = await me();
    const parsed = passwordShape.safeParse({
      current: formData.get('current') ?? '',
      next: formData.get('next') ?? '',
      again: formData.get('again') ?? '',
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;
    if (d.next !== d.again) return { error: 'The two new passwords do not match.' };
    if (d.next === d.current) return { error: 'That is the same password.' };

    const account = await db.user.findFirst({ where: { id: user.id, organizationId: tenant.organizationId }, select: { passwordHash: true } });
    if (!account?.passwordHash) return { error: 'This account has no password yet. Use "Forgot password" on the sign-in page to set one.' };
    if (!(await verifyPassword(d.current, account.passwordHash))) return { error: 'The current password is wrong.' };

    // Every other device is signed out; the one making the change stays.
    const token = (await cookies()).get(SESSION_COOKIE)?.value ?? '';
    await db.$transaction([
      db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(d.next), mustResetPassword: false } }),
      db.authSession.deleteMany({ where: { userId: user.id, sessionToken: { not: token } } }),
    ]);
    await recordAudit({ organizationId: tenant.organizationId, actorId: user.id, action: 'account.password_changed', entity: 'User', entityId: user.id });
    revalidatePath('/learn/account/security');
    return { ok: true, message: 'Password changed. Any other device you were signed in on has been signed out.' };
  } catch (err) {
    return fail(err);
  }
}

export async function signOutOtherDevices(): Promise<ActionState> {
  try {
    const { user } = await me();
    const token = (await cookies()).get(SESSION_COOKIE)?.value ?? '';
    const gone = await db.authSession.deleteMany({ where: { userId: user.id, sessionToken: { not: token } } });
    revalidatePath('/learn/account/security');
    return { ok: true, message: gone.count === 0 ? 'No other device was signed in.' : `Signed out ${gone.count} other device${gone.count === 1 ? '' : 's'}.` };
  } catch (err) {
    return fail(err);
  }
}

/** Recomputed after every change, so the number on the page is never stale. */
async function refreshCompletion(organizationId: string, userId: string) {
  const [account, custom] = await Promise.all([
    db.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true, phone: true, avatarUrl: true, dateOfBirth: true, gender: true, learnerProfile: { select: { occupation: true, area: true, residentialAddress: true, parentPhone: true } } },
    }),
    fieldsFor(organizationId, 'LEARNER', userId),
  ]);
  if (!account) return;
  const percent = profileCompletion({ ...account, profile: account.learnerProfile, requiredCustom: custom.filter((f) => f.required) });
  await db.learnerProfile.upsert({
    where: { userId },
    create: { userId, profileCompletion: percent },
    update: { profileCompletion: percent },
  });
}
